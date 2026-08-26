import * as StellarSDK from '@stellar/stellar-sdk';
import { getConfig } from '../config/env.js';
import { getIssuer } from '../config/assets.js';
import logger from '../config/logger.js';
import prisma from '../db/client.js';
import { eventMonitor } from '../eventSourcing/index.js';
import { getHorizonServer, withHorizonRetry } from './stellar.js';
import { extractStellarErrorCode, getStellarErrorInfo } from '../utils/stellarErrors.js';

function isTestnet() {
  return getConfig().stellar.network === 'testnet';
}

function networkPassphrase() {
  return isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC;
}

function toAsset(code, issuer) {
  if (code === 'XLM') return StellarSDK.Asset.native();
  const iss = issuer || getIssuer(code);
  if (!iss) throw new Error(`No issuer for asset ${code}`);
  return new StellarSDK.Asset(code, iss);
}

// ── Path Finding ──────────────────────────────────────────────────────────────

/**
 * Path Payments
 * A path payment allows the sender to send one asset while the recipient
 * receives a different asset. The Stellar network automatically routes the
 * conversion through on-chain order books or AMM liquidity pools to find the
 * best available conversion path — no manual swap step is required.
 * Two variants are supported:
 *   - Strict-send (pathPaymentStrictSend): the send amount is fixed; the network
 *     maximises how much the recipient receives.
 *   - Strict-receive (pathPaymentStrictReceive): the destination amount is fixed;
 *     the network minimises how much the sender must spend.
 * @see https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-list#path-payment-strict-send
 */

/**
 * Find paths between two assets using Horizon's strict-send path-finding.
 * Returns paths sorted by best destination amount (descending).
 * @param {object} opts
 * @param {{code: string, issuer?: string}} opts.sourceAsset - Asset to send (issuer resolved via config if omitted)
 * @param {number|string} opts.sourceAmount - Amount of `sourceAsset` to send
 * @param {{code: string, issuer?: string}} opts.destinationAsset - Asset the recipient should receive
 * @param {string} [opts.destinationAccount] - Currently unused; reserved for destination-scoped path lookups
 * @returns {Promise<Array<{sourceAsset: string, sourceAmount: string, destinationAsset: string, destinationAmount: string, path: string[]}>>} Candidate paths, best destination amount first
 */
export async function findPaths({ sourceAsset, sourceAmount, destinationAsset, destinationAccount }) {
  const src = toAsset(sourceAsset.code, sourceAsset.issuer);
  const dst = toAsset(destinationAsset.code, destinationAsset.issuer);

  const result = await withHorizonRetry(() =>
    getHorizonServer().strictSendPaths(src, sourceAmount.toString(), [dst]).call()
  );

  const paths = (result.records || []).map(r => ({
    sourceAsset: r.source_asset_type === 'native' ? 'XLM' : r.source_asset_code,
    sourceAmount: r.source_amount,
    destinationAsset: r.destination_asset_type === 'native' ? 'XLM' : r.destination_asset_code,
    destinationAmount: r.destination_amount,
    path: r.path.map(p => (p.asset_type === 'native' ? 'XLM' : p.asset_code)),
  }));

  // Sort best rate first
  paths.sort((a, b) => parseFloat(b.destinationAmount) - parseFloat(a.destinationAmount));

  logger.info('pathPayment.findPaths', { sourceAsset: sourceAsset.code, destinationAsset: destinationAsset.code, count: paths.length });
  return paths;
}

/**
 * Find paths using strict-receive (fix destination amount).
 * @param {object} opts
 * @param {{code: string, issuer?: string}} opts.sourceAsset - Asset to send (issuer resolved via config if omitted)
 * @param {{code: string, issuer?: string}} opts.destinationAsset - Asset the recipient should receive
 * @param {number|string} opts.destinationAmount - Fixed amount of `destinationAsset` the recipient should receive
 * @returns {Promise<Array<{sourceAsset: string, sourceAmount: string, destinationAsset: string, destinationAmount: string, path: string[]}>>} Candidate paths, sorted by lowest required source amount first
 */
export async function findPathsStrictReceive({ sourceAsset, destinationAsset, destinationAmount }) {
  const src = toAsset(sourceAsset.code, sourceAsset.issuer);
  const dst = toAsset(destinationAsset.code, destinationAsset.issuer);

  const result = await withHorizonRetry(() =>
    getHorizonServer().strictReceivePaths([src], dst, destinationAmount.toString()).call()
  );

  const paths = (result.records || []).map(r => ({
    sourceAsset: r.source_asset_type === 'native' ? 'XLM' : r.source_asset_code,
    sourceAmount: r.source_amount,
    destinationAsset: r.destination_asset_type === 'native' ? 'XLM' : r.destination_asset_code,
    destinationAmount: r.destination_amount,
    path: r.path.map(p => (p.asset_type === 'native' ? 'XLM' : p.asset_code)),
  }));

  paths.sort((a, b) => parseFloat(a.sourceAmount) - parseFloat(b.sourceAmount));
  return paths;
}

// ── Slippage ──────────────────────────────────────────────────────────────────

/**
 * Reduce a destination amount by a slippage tolerance.
 * @param {number|string} amount - Destination amount before slippage
 * @param {number} [slippageBps=50] - Slippage tolerance in basis points (e.g. 50 = 0.5%)
 * @returns {string} Amount after applying slippage, fixed to 7 decimal places
 */
export function applySlippage(amount, slippageBps = 50) {
  const factor = 1 - slippageBps / 10000;
  return (parseFloat(amount) * factor).toFixed(7);
}

// ── Transaction Building ──────────────────────────────────────────────────────

/**
 * Build and submit a strict-send path payment.
 * Sends exactly `sendAmount` of `sendAsset`, receives at least `minDestAmount` of `destAsset`.
 * @param {object} opts
 * @param {string} opts.sourceSecret - Secret key of the sending account
 * @param {string} opts.destination - Stellar public key of the recipient
 * @param {{code: string, issuer?: string}} opts.sendAsset - Asset to send
 * @param {number|string} opts.sendAmount - Amount of `sendAsset` to send
 * @param {{code: string, issuer?: string}} opts.destAsset - Asset the recipient should receive
 * @param {Array<string|{code: string, issuer?: string}>} [opts.path=[]] - Explicit conversion path; when omitted, the best path from {@link findPaths} is used
 * @param {number} [opts.slippageBps=50] - Slippage tolerance in basis points applied to the expected destination amount
 * @returns {Promise<{hash: string, ledger: number, success: boolean, destMin: string}>} Submission result
 * @throws {Error} If no path is found between the assets, or Horizon submission fails (with a user-friendly `message` and `.code`)
 */
export async function sendPathPayment({
  sourceSecret,
  destination,
  sendAsset,
  sendAmount,
  destAsset,
  path = [],
  slippageBps = 50,
}) {
  const keypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = keypair.publicKey();

  const srcAsset = toAsset(sendAsset.code, sendAsset.issuer);
  const dstAsset = toAsset(destAsset.code, destAsset.issuer);

  // Find best path if not provided — single call reused for both resolvedPath and destMin
  let resolvedPath = path;
  let bestDestAmount = sendAmount;

  if (!resolvedPath.length) {
    const paths = await findPaths({ sourceAsset: sendAsset, sourceAmount: sendAmount, destinationAsset: destAsset });
    if (!paths.length) throw new Error('No path found between assets');
    bestDestAmount = paths[0].destinationAmount;
    resolvedPath = paths[0].path
      .filter(p => p !== sendAsset.code && p !== destAsset.code)
      .map(code => toAsset(code));
  } else {
    resolvedPath = resolvedPath.map(p => toAsset(p.code || p, p.issuer));
    // Still need bestDestAmount when an explicit path is provided — do one lookup
    const paths = await findPaths({ sourceAsset: sendAsset, sourceAmount: sendAmount, destinationAsset: destAsset });
    if (paths.length) bestDestAmount = paths[0].destinationAmount;
  }

  const destMin = applySlippage(bestDestAmount, slippageBps);

  const account = await withHorizonRetry(() => getHorizonServer().loadAccount(sourcePublicKey));

  const tx = new StellarSDK.TransactionBuilder(account, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(StellarSDK.Operation.pathPaymentStrictSend({
      sendAsset: srcAsset,
      sendAmount: sendAmount.toString(),
      destination,
      destAsset: dstAsset,
      destMin,
      path: resolvedPath,
    }))
    .setTimeout(30)
    .build();

  tx.sign(keypair);

  let result;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(tx));
  } catch (err) {
    const code = extractStellarErrorCode(err);
    const { userMessage } = getStellarErrorInfo(code);
    logger.error('pathPayment.send.failed', { source: sourcePublicKey, destination, code, error: err.message });
    const mapped = new Error(userMessage);
    mapped.code = code;
    mapped.original = err;
    throw mapped;
  }

  logger.info('pathPayment.send.success', { hash: result.hash, source: sourcePublicKey, destination });

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'PathPaymentSent',
    data: { destination, sendAmount, sendAsset: sendAsset.code, destAsset: destAsset.code, hash: result.hash },
    version: 1,
  });

  // Persist
  await prisma.$transaction(async (prismaTx) => {
    const [sender, recipient] = await Promise.all([
      prismaTx.user.upsert({ where: { publicKey: sourcePublicKey }, update: {}, create: { publicKey: sourcePublicKey } }),
      prismaTx.user.upsert({ where: { publicKey: destination }, update: {}, create: { publicKey: destination } }),
    ]);
    await prismaTx.transaction.create({
      data: {
        hash: result.hash,
        assetCode: destAsset.code,
        amount: sendAmount,
        ledger: result.ledger ?? null,
        successful: result.successful,
        senderId: sender.id,
        recipientId: recipient.id,
      },
    });
  }).catch(err => logger.warn('db.pathPayment.save.failed', { error: err.message }));

  return { hash: result.hash, ledger: result.ledger, success: result.successful, destMin };
}

// ── Path Optimization ─────────────────────────────────────────────────────────

/**
 * Compare strict-send vs strict-receive paths and return the optimal route.
 * Optimizes for best effective rate (most destination per source unit).
 * @param {object} opts
 * @param {{code: string, issuer?: string}} opts.sendAsset - Asset to send
 * @param {number|string} opts.sendAmount - Amount of `sendAsset` to send, used for the strict-send comparison
 * @param {{code: string, issuer?: string}} opts.destAsset - Asset the recipient should receive
 * @param {number|string} [opts.destAmount] - Fixed destination amount; when provided, strict-receive paths are also compared
 * @returns {Promise<{recommended: 'strictSend'|'strictReceive', strictSend: object|null, strictReceive: object|null, effectiveRates: {strictSend: number, strictReceive: number}}>} The better route and both candidates
 */
export async function optimizePath({ sendAsset, sendAmount, destAsset, destAmount }) {
  const [sendPaths, receivePaths] = await Promise.allSettled([
    findPaths({ sourceAsset: sendAsset, sourceAmount: sendAmount, destinationAsset: destAsset }),
    destAmount ? findPathsStrictReceive({ sourceAsset: sendAsset, destinationAsset: destAsset, destinationAmount: destAmount }) : Promise.resolve([]),
  ]);

  const best = {
    strictSend: sendPaths.status === 'fulfilled' ? sendPaths.value[0] || null : null,
    strictReceive: receivePaths.status === 'fulfilled' ? receivePaths.value[0] || null : null,
  };

  // Effective rate = destAmount / sourceAmount
  const rateA = best.strictSend ? parseFloat(best.strictSend.destinationAmount) / parseFloat(best.strictSend.sourceAmount) : 0;
  const rateB = best.strictReceive ? parseFloat(best.strictReceive.destinationAmount) / parseFloat(best.strictReceive.sourceAmount) : 0;

  return {
    recommended: rateA >= rateB ? 'strictSend' : 'strictReceive',
    strictSend: best.strictSend,
    strictReceive: best.strictReceive,
    effectiveRates: { strictSend: rateA, strictReceive: rateB },
  };
}

// ── Analytics ─────────────────────────────────────────────────────────────────

const _analytics = { totalPathPayments: 0, totalVolume: {}, failedAttempts: 0 };

/**
 * Record a path payment attempt into the in-memory analytics counters.
 * @param {object} opts
 * @param {string} opts.sendAsset - Asset code that was sent
 * @param {number|string} opts.sendAmount - Amount sent (only accumulated into volume on success)
 * @param {boolean} opts.success - Whether the path payment succeeded
 * @returns {void}
 */
export function recordPathPaymentAnalytic({ sendAsset, sendAmount, success }) {
  if (success) {
    _analytics.totalPathPayments++;
    _analytics.totalVolume[sendAsset] = (_analytics.totalVolume[sendAsset] || 0) + parseFloat(sendAmount);
  } else {
    _analytics.failedAttempts++;
  }
}

/**
 * Get a snapshot of in-memory path payment analytics.
 * @returns {{totalPathPayments: number, totalVolume: Object<string, number>, failedAttempts: number, timestamp: string}} Analytics snapshot
 */
export function getPathPaymentAnalytics() {
  return { ..._analytics, timestamp: new Date().toISOString() };
}
