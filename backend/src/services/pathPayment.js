import * as StellarSDK from '@stellar/stellar-sdk';
import { getConfig } from '../config/env.js';
import { getIssuer } from '../config/assets.js';
import logger from '../config/logger.js';
import prisma from '../db/client.js';
import { eventMonitor } from '../eventSourcing/index.js';

let _server;
function getServer() {
  const { horizonUrl } = getConfig().stellar;
  if (!_server) _server = new StellarSDK.Horizon.Server(horizonUrl);
  return _server;
}

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
 * Find paths between two assets using Horizon's strict-send path-finding.
 * Returns paths sorted by best destination amount (descending).
 */
export async function findPaths({ sourceAsset, sourceAmount, destinationAsset, destinationAccount }) {
  const src = toAsset(sourceAsset.code, sourceAsset.issuer);
  const dst = toAsset(destinationAsset.code, destinationAsset.issuer);

  const result = await getServer()
    .strictSendPaths(src, sourceAmount.toString(), [dst])
    .call();

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
 */
export async function findPathsStrictReceive({ sourceAsset, destinationAsset, destinationAmount }) {
  const src = toAsset(sourceAsset.code, sourceAsset.issuer);
  const dst = toAsset(destinationAsset.code, destinationAsset.issuer);

  const result = await getServer()
    .strictReceivePaths([src], dst, destinationAmount.toString())
    .call();

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
 * Apply slippage tolerance to a destination amount.
 * slippageBps: basis points (e.g. 50 = 0.5%)
 */
export function applySlippage(amount, slippageBps = 50) {
  const factor = 1 - slippageBps / 10000;
  return (parseFloat(amount) * factor).toFixed(7);
}

// ── Transaction Building ──────────────────────────────────────────────────────

/**
 * Build and submit a strict-send path payment.
 * Sends exactly `sendAmount` of `sendAsset`, receives at least `minDestAmount` of `destAsset`.
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

  // Find best path if not provided
  let resolvedPath = path;
  if (!resolvedPath.length) {
    const paths = await findPaths({ sourceAsset: sendAsset, sourceAmount: sendAmount, destinationAsset: destAsset });
    if (!paths.length) throw new Error('No path found between assets');
    resolvedPath = paths[0].path
      .filter(p => p !== sendAsset.code && p !== destAsset.code)
      .map(code => toAsset(code));
  } else {
    resolvedPath = resolvedPath.map(p => toAsset(p.code || p, p.issuer));
  }

  // Determine min destination amount with slippage
  const paths = await findPaths({ sourceAsset: sendAsset, sourceAmount: sendAmount, destinationAsset: destAsset });
  const bestDestAmount = paths[0]?.destinationAmount || sendAmount;
  const destMin = applySlippage(bestDestAmount, slippageBps);

  const account = await getServer().loadAccount(sourcePublicKey);

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
    result = await getServer().submitTransaction(tx);
  } catch (err) {
    logger.error('pathPayment.send.failed', { source: sourcePublicKey, destination, error: err.message });
    throw err;
  }

  logger.info('pathPayment.send.success', { hash: result.hash, source: sourcePublicKey, destination });

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'PathPaymentSent',
    data: { destination, sendAmount, sendAsset: sendAsset.code, destAsset: destAsset.code, hash: result.hash },
    version: 1,
  });

  // Persist
  await prisma.$transaction(async (tx) => {
    const [sender, recipient] = await Promise.all([
      tx.user.upsert({ where: { publicKey: sourcePublicKey }, update: {}, create: { publicKey: sourcePublicKey } }),
      tx.user.upsert({ where: { publicKey: destination }, update: {}, create: { publicKey: destination } }),
    ]);
    await tx.transaction.create({
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

export function recordPathPaymentAnalytic({ sendAsset, sendAmount, success }) {
  if (success) {
    _analytics.totalPathPayments++;
    _analytics.totalVolume[sendAsset] = (_analytics.totalVolume[sendAsset] || 0) + parseFloat(sendAmount);
  } else {
    _analytics.failedAttempts++;
  }
}

export function getPathPaymentAnalytics() {
  return { ..._analytics, timestamp: new Date().toISOString() };
}
