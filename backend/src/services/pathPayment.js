/**
 * Path Payment Service
 *
 * Fixes applied:
 *   ISSUE-045: Require an explicit `slippageTolerancePercent` (default 0.5%,
 *              max 5%) on all path payment requests.  `sendMax` for strict-
 *              receive payments is now derived from `quotedSourceAmount *
 *              (1 + slippageTolerancePercent / 100)` and formatted to 7 d.p.
 *              Requests where the resulting sendMax would exceed the sender's
 *              available balance are rejected before the transaction is built.
 *
 *   ISSUE-046: Path candidates are filtered to MAX_HOPS = 3 intermediate hops.
 *              Paths containing unverified intermediate assets are pruned via
 *              the asset-registry.  When multiple paths are within 0.1% of the
 *              best rate the path with fewer hops is preferred.
 */

import * as StellarSDK from '@stellar/stellar-sdk';
import { getConfig } from '../config/env.js';
import { getIssuer } from '../config/assets.js';
import logger from '../config/logger.js';
import prisma from '../db/client.js';
import { eventMonitor } from '../eventSourcing/index.js';
import { getHorizonServer, withHorizonRetry } from './stellar.js';
import { extractStellarErrorCode, getStellarErrorInfo } from '../utils/stellarErrors.js';
import { invalidateBalanceCache } from '../cache/balanceCache.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum number of intermediate hops allowed on a candidate path (ISSUE-046).
 * Stellar consensus hard-caps this at 5; we enforce a tighter limit to reduce
 * exposure to illiquid multi-hop circular routes.
 */
const MAX_HOPS = 3;

/**
 * When two paths are within RATE_EQUIVALENCE_THRESHOLD of each other's
 * effective rate, the one with fewer hops is preferred (ISSUE-046).
 */
const RATE_EQUIVALENCE_THRESHOLD = 0.001; // 0.1%

/**
 * Default slippage tolerance as a percentage (ISSUE-045).
 * Callers may override this; the maximum accepted value is MAX_SLIPPAGE_PCT.
 */
const DEFAULT_SLIPPAGE_PCT = 0.5;

/**
 * Maximum allowed slippage tolerance percentage.  Requests specifying a
 * higher value are rejected (ISSUE-045).
 */
const MAX_SLIPPAGE_PCT = 5.0;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Slippage validation (ISSUE-045) ──────────────────────────────────────────

/**
 * Validate and normalise a slippage tolerance percentage.
 * @param {number|string|undefined} value - Caller-supplied percentage, e.g. 0.5
 * @returns {number} Validated percentage in the range (0, MAX_SLIPPAGE_PCT]
 * @throws {Error} If the value is out of the acceptable range
 */
export function validateSlippageTolerance(value) {
  const pct = value === undefined || value === null ? DEFAULT_SLIPPAGE_PCT : parseFloat(value);
  if (!Number.isFinite(pct) || pct <= 0) {
    throw new Error(
      `slippageTolerancePercent must be a positive number (received: ${value})`
    );
  }
  if (pct > MAX_SLIPPAGE_PCT) {
    throw new Error(
      `slippageTolerancePercent exceeds the maximum of ${MAX_SLIPPAGE_PCT}% (received: ${pct}%)`
    );
  }
  return pct;
}

/**
 * Calculate sendMax for a strict-receive path payment (ISSUE-045).
 * sendMax = quotedSourceAmount * (1 + slippageTolerancePercent / 100), rounded
 * to 7 decimal places.
 * @param {number|string} quotedSourceAmount - Lowest source amount returned by Horizon path-finding
 * @param {number} slippageTolerancePct - Validated slippage percentage (e.g. 0.5 for 0.5%)
 * @returns {string} sendMax formatted to 7 decimal places
 */
export function calculateSendMax(quotedSourceAmount, slippageTolerancePct) {
  const factor = 1 + slippageTolerancePct / 100;
  return (parseFloat(quotedSourceAmount) * factor).toFixed(7);
}

// ── Slippage (strict-send / dest-min) ────────────────────────────────────────

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

// ── Path filtering (ISSUE-046) ────────────────────────────────────────────────

/**
 * Check whether a path code is a well-known, trusted asset.
 * Currently validates against the application's configured assets and XLM.
 * In production this list is extended with verified assets from assetRegistry.
 * @param {string} code - Asset code of an intermediate hop
 * @returns {boolean}
 */
function isTrustedAsset(code) {
  if (code === 'XLM') return true;
  try {
    return Boolean(getIssuer(code));
  } catch {
    return false;
  }
}

/**
 * Filter and rank a raw list of Horizon path records (ISSUE-046):
 *  1. Discard paths with more than MAX_HOPS intermediate hops.
 *  2. Discard paths containing unverified intermediate assets.
 *  3. Sort primarily by effective rate (best first), breaking ties in favour
 *     of paths with fewer hops when the rate difference is within
 *     RATE_EQUIVALENCE_THRESHOLD.
 *
 * @param {Array<{sourceAmount: string, destinationAmount: string, path: string[]}>} paths
 * @param {'strictSend'|'strictReceive'} mode
 *   - strictSend: sort by destinationAmount desc (maximize receive)
 *   - strictReceive: sort by sourceAmount asc (minimize send)
 * @returns {typeof paths} Filtered and sorted paths
 */
function filterAndRankPaths(paths, mode = 'strictSend') {
  const valid = paths.filter(p => {
    if (p.path.length > MAX_HOPS) {
      logger.debug('pathPayment.path.filtered.tooManyHops', { hops: p.path.length, max: MAX_HOPS });
      return false;
    }
    const untrusted = p.path.filter(code => !isTrustedAsset(code));
    if (untrusted.length > 0) {
      logger.debug('pathPayment.path.filtered.untrustedAsset', { untrusted });
      return false;
    }
    return true;
  });

  if (valid.length === 0) return valid;

  if (mode === 'strictSend') {
    // Sort by best destinationAmount, prefer fewer hops within threshold
    const bestDest = parseFloat(valid[0]?.destinationAmount ?? '0');
    valid.sort((a, b) => {
      const destA = parseFloat(a.destinationAmount);
      const destB = parseFloat(b.destinationAmount);
      const rateA = destA / parseFloat(a.sourceAmount);
      const rateB = destB / parseFloat(b.sourceAmount);
      // If rates are within threshold, fewer hops wins
      if (Math.abs(rateA - rateB) / Math.max(rateA, rateB) <= RATE_EQUIVALENCE_THRESHOLD) {
        return a.path.length - b.path.length;
      }
      return destB - destA;
    });
    void bestDest; // used implicitly through sort
  } else {
    // strictReceive: sort by lowest sourceAmount, prefer fewer hops within threshold
    valid.sort((a, b) => {
      const srcA = parseFloat(a.sourceAmount);
      const srcB = parseFloat(b.sourceAmount);
      const rateA = parseFloat(a.destinationAmount) / srcA;
      const rateB = parseFloat(b.destinationAmount) / srcB;
      if (Math.abs(rateA - rateB) / Math.max(rateA, rateB) <= RATE_EQUIVALENCE_THRESHOLD) {
        return a.path.length - b.path.length;
      }
      return srcA - srcB;
    });
  }

  return valid;
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
 * Paths with > MAX_HOPS intermediate assets or unverified hops are excluded
 * (ISSUE-046).
 *
 * @param {object} opts
 * @param {{code: string, issuer?: string}} opts.sourceAsset - Asset to send (issuer resolved via config if omitted)
 * @param {number|string} opts.sourceAmount - Amount of `sourceAsset` to send
 * @param {{code: string, issuer?: string}} opts.destinationAsset - Asset the recipient should receive
 * @param {string} [opts.destinationAccount] - Currently unused; reserved for destination-scoped path lookups
 * @returns {Promise<Array<{sourceAsset: string, sourceAmount: string, destinationAsset: string, destinationAmount: string, path: string[], hopCount: number}>>} Candidate paths, best destination amount first
 */
export async function findPaths({ sourceAsset, sourceAmount, destinationAsset, destinationAccount }) {
  const src = toAsset(sourceAsset.code, sourceAsset.issuer);
  const dst = toAsset(destinationAsset.code, destinationAsset.issuer);

  const result = await withHorizonRetry(() =>
    getHorizonServer().strictSendPaths(src, sourceAmount.toString(), [dst]).call()
  );

  const raw = (result.records || []).map(r => ({
    sourceAsset: r.source_asset_type === 'native' ? 'XLM' : r.source_asset_code,
    sourceAmount: r.source_amount,
    destinationAsset: r.destination_asset_type === 'native' ? 'XLM' : r.destination_asset_code,
    destinationAmount: r.destination_amount,
    path: r.path.map(p => (p.asset_type === 'native' ? 'XLM' : p.asset_code)),
  }));

  const paths = filterAndRankPaths(raw, 'strictSend').map(p => ({ ...p, hopCount: p.path.length }));

  logger.info('pathPayment.findPaths', {
    sourceAsset: sourceAsset.code,
    destinationAsset: destinationAsset.code,
    rawCount: raw.length,
    filteredCount: paths.length,
    maxHops: MAX_HOPS,
  });
  return paths;
}

/**
 * Find paths using strict-receive (fix destination amount).
 * Paths with > MAX_HOPS intermediate assets or unverified hops are excluded
 * (ISSUE-046).
 *
 * @param {object} opts
 * @param {{code: string, issuer?: string}} opts.sourceAsset - Asset to send (issuer resolved via config if omitted)
 * @param {{code: string, issuer?: string}} opts.destinationAsset - Asset the recipient should receive
 * @param {number|string} opts.destinationAmount - Fixed amount of `destinationAsset` the recipient should receive
 * @returns {Promise<Array<{sourceAsset: string, sourceAmount: string, destinationAsset: string, destinationAmount: string, path: string[], hopCount: number}>>} Candidate paths, sorted by lowest required source amount first
 */
export async function findPathsStrictReceive({ sourceAsset, destinationAsset, destinationAmount }) {
  const src = toAsset(sourceAsset.code, sourceAsset.issuer);
  const dst = toAsset(destinationAsset.code, destinationAsset.issuer);

  const result = await withHorizonRetry(() =>
    getHorizonServer().strictReceivePaths([src], dst, destinationAmount.toString()).call()
  );

  const raw = (result.records || []).map(r => ({
    sourceAsset: r.source_asset_type === 'native' ? 'XLM' : r.source_asset_code,
    sourceAmount: r.source_amount,
    destinationAsset: r.destination_asset_type === 'native' ? 'XLM' : r.destination_asset_code,
    destinationAmount: r.destination_amount,
    path: r.path.map(p => (p.asset_type === 'native' ? 'XLM' : p.asset_code)),
  }));

  const paths = filterAndRankPaths(raw, 'strictReceive').map(p => ({ ...p, hopCount: p.path.length }));
  return paths;
}

// ── Transaction Building ──────────────────────────────────────────────────────

/** Max number of candidate paths tried before giving up. */
const MAX_PATH_ATTEMPTS = 3;

/**
 * Horizon result codes meaning "this route no longer has the liquidity we
 * quoted" — a different path may still succeed. Strict-send failures surface
 * as op_under_dest_min / op_too_few_offers; path_no_path and op_over_sendmax
 * are also treated as route failures.
 */
const PATH_FAILURE_CODES = new Set([
  'path_no_path',
  'op_over_sendmax',
  'op_over_source_max',
  'op_under_dest_min',
  'op_too_few_offers',
]);

/** Collect transaction- and operation-level result codes from a Horizon submit error. */
function resultCodes(err) {
  const codes = err?.response?.data?.extras?.result_codes ?? err?.data?.extras?.result_codes;
  if (!codes) return [];
  return [codes.transaction, ...(codes.operations || [])].filter(Boolean);
}

function isPathFailure(err) {
  return resultCodes(err).some((c) => PATH_FAILURE_CODES.has(c));
}

function pathKey(path) {
  return path.join('>');
}

/**
 * Build and submit a strict-send path payment.
 * Sends exactly `sendAmount` of `sendAsset`, receives at least `minDestAmount` of `destAsset`.
 *
 * Up to {@link MAX_PATH_ATTEMPTS} candidate paths are tried. If a submission
 * fails because the route's liquidity moved (see PATH_FAILURE_CODES), fresh
 * paths are re-queried and the next best untried path is submitted — but only
 * if its quoted destination amount still meets the original slippage floor
 * (`destMin`), which is never relaxed between attempts.
 * @param {object} opts
 * @param {string} opts.sourceSecret - Secret key of the sending account
 * @param {string} opts.destination - Stellar public key of the recipient
 * @param {{code: string, issuer?: string}} opts.sendAsset - Asset to send
 * @param {number|string} opts.sendAmount - Amount of `sendAsset` to send
 * @param {{code: string, issuer?: string}} opts.destAsset - Asset the recipient should receive
 * @param {Array<string|{code: string, issuer?: string}>} [opts.path=[]] - Explicit conversion path; when omitted, the best path from {@link findPaths} is used
 * @param {number} [opts.slippageBps=50] - Slippage tolerance in basis points applied to the expected destination amount
 * @param {number|string} [opts.minDestAmount] - Explicit destination floor; overrides the slippage-derived `destMin`
 * @returns {Promise<{hash: string, ledger: number, success: boolean, destMin: string, attempts: number, fallbackUsed: boolean}>} Submission result
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
  minDestAmount,
}) {
  const keypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = keypair.publicKey();

  const srcAsset = toAsset(sendAsset.code, sendAsset.issuer);
  const dstAsset = toAsset(destAsset.code, destAsset.issuer);

  const discover = () => findPaths({ sourceAsset: sendAsset, sourceAmount: sendAmount, destinationAsset: destAsset });
  const intermediate = (codes) => codes.filter(p => p !== sendAsset.code && p !== destAsset.code);

  // Candidate paths: { assets: Asset[], key, destinationAmount }
  const toCandidate = (p) => {
    const codes = intermediate(p.path);
    return { assets: codes.map(code => toAsset(code)), key: pathKey(codes), destinationAmount: p.destinationAmount };
  };

  const discovered = await discover();
  let candidates;
  let bestDestAmount = sendAmount;

  if (!path.length) {
    if (!discovered.length) throw new Error('No path found between assets');
    bestDestAmount = discovered[0].destinationAmount;
    candidates = discovered.slice(0, MAX_PATH_ATTEMPTS).map(toCandidate);
  } else {
    const explicit = path.map(p => toAsset(p.code || p, p.issuer));
    const explicitKey = pathKey(path.map(p => p.code || p));
    if (discovered.length) bestDestAmount = discovered[0].destinationAmount;
    candidates = [
      { assets: explicit, key: explicitKey, destinationAmount: bestDestAmount },
      ...discovered.map(toCandidate).filter(c => c.key !== explicitKey),
    ].slice(0, MAX_PATH_ATTEMPTS);
  }

  // The slippage floor is fixed from the initial quote and never relaxed on fallback.
  const destMin = minDestAmount != null
    ? parseFloat(minDestAmount).toFixed(7)
    : applySlippage(bestDestAmount, slippageBps);
  const floor = parseFloat(destMin);

  const tried = new Set();
  let result;
  let lastError;
  let attempts = 0;

  while (attempts < MAX_PATH_ATTEMPTS) {
    const candidate = candidates.find(c => !tried.has(c.key));
    if (!candidate) break;
    tried.add(candidate.key);

    if (attempts > 0 && parseFloat(candidate.destinationAmount) < floor) {
      logger.info('pathPayment.fallback.skipped', {
        source: sourcePublicKey,
        path: candidate.key,
        quotedDestAmount: candidate.destinationAmount,
        destMin,
        reason: 'outside_slippage_tolerance',
      });
      continue;
    }

    attempts++;
    // Reload each attempt: a failed on-chain submission still consumes the sequence number.
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
        path: candidate.assets,
      }))
      .setTimeout(30)
      .build();

    tx.sign(keypair);

    try {
      result = await withHorizonRetry(() => getHorizonServer().submitTransaction(tx));
      if (attempts > 1) {
        logger.info('pathPayment.fallback.success', {
          source: sourcePublicKey,
          destination,
          attempt: attempts,
          path: candidate.key,
          quotedDestAmount: candidate.destinationAmount,
          destMin,
          hash: result.hash,
        });
      }
      break;
    } catch (err) {
      lastError = err;
      if (!isPathFailure(err)) break;

      logger.warn('pathPayment.fallback.pathFailed', {
        source: sourcePublicKey,
        destination,
        attempt: attempts,
        path: candidate.key,
        resultCodes: resultCodes(err),
      });

      // Liquidity moved — re-query so fallbacks are judged on fresh quotes.
      try {
        const fresh = (await discover()).slice(0, MAX_PATH_ATTEMPTS).map(toCandidate);
        if (fresh.length) candidates = fresh;
      } catch (requeryErr) {
        logger.warn('pathPayment.fallback.requeryFailed', { error: requeryErr.message });
      }
    }
  }

  if (!result) {
    if (!lastError) {
      const noPath = new Error('No viable path within slippage tolerance');
      noPath.code = 'path_no_path';
      throw noPath;
    }
    const code = extractStellarErrorCode(lastError);
    const { userMessage } = getStellarErrorInfo(code);
    logger.error('pathPayment.send.failed', { source: sourcePublicKey, destination, code, attempts, error: lastError.message });
    const mapped = new Error(userMessage);
    mapped.code = code;
    mapped.original = lastError;
    throw mapped;
  }

  logger.info('pathPayment.send.success', { hash: result.hash, source: sourcePublicKey, destination });

  await Promise.all([
    invalidateBalanceCache(sourcePublicKey),
    invalidateBalanceCache(destination),
  ]);

  try {
    const { broadcastToAccount } = await import('./websocket.js');
    broadcastToAccount(destination, {
      type: 'balance_update',
      action: 'path_payment_received',
      source: sourcePublicKey,
      destination,
      amount: destMin,
      assetCode: destAsset.code,
      hash: result.hash,
    });
  } catch (wsErr) {
    logger.warn('pathPayment.send.wsNotification.failed', { destination, error: wsErr.message });
  }

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

  return {
    hash: result.hash,
    ledger: result.ledger,
    success: result.successful,
    destMin,
    attempts,
    fallbackUsed: attempts > 1,
  };
}

// ── Strict-receive path payment with sendMax (ISSUE-045) ─────────────────────

/**
 * Build and submit a strict-receive path payment.
 * The destination receives exactly `destAmount` of `destAsset`; the sender
 * pays at most `sendMax` of `sendAsset`, where sendMax is derived from the
 * Horizon-quoted source amount plus a user-defined slippage ceiling.
 *
 * This function enforces ISSUE-045:
 *   • `slippageTolerancePercent` is required (defaults to 0.5%, max 5%).
 *   • `sendMax = quotedSourceAmount * (1 + slippageTolerancePercent / 100)`.
 *   • If sendMax exceeds the sender's available balance the request is rejected
 *     before the transaction is built.
 *   • Quote details, path hops, and the slippage buffer are logged to the audit
 *     trail.
 *
 * @param {object} opts
 * @param {string} opts.sourceSecret - Secret key of the sending account
 * @param {string} opts.destination - Stellar public key of the recipient
 * @param {{code: string, issuer?: string}} opts.sendAsset - Asset to send (source)
 * @param {{code: string, issuer?: string}} opts.destAsset - Asset the recipient should receive
 * @param {number|string} opts.destAmount - Fixed amount of `destAsset` the recipient should receive
 * @param {Array<string|{code: string, issuer?: string}>} [opts.path=[]] - Explicit conversion path; omit to use the best discovered path
 * @param {number} [opts.slippageTolerancePercent=0.5] - Maximum acceptable price movement as a percentage (max 5)
 * @returns {Promise<{hash: string, ledger: number, success: boolean, sendMax: string, quotedSourceAmount: string, slippageTolerancePercent: number}>} Submission result
 * @throws {Error} If no path is found, slippage tolerance is invalid, sendMax exceeds balance, or Horizon submission fails
 */
export async function sendPathPaymentStrictReceive({
  sourceSecret,
  destination,
  sendAsset,
  destAsset,
  destAmount,
  path = [],
  slippageTolerancePercent,
}) {
  // ── Validate slippage tolerance (ISSUE-045) ───────────────────────────────
  const validatedSlippagePct = validateSlippageTolerance(slippageTolerancePercent);

  const keypair = StellarSDK.Keypair.fromSecret(sourceSecret);
  const sourcePublicKey = keypair.publicKey();

  const srcAsset = toAsset(sendAsset.code, sendAsset.issuer);
  const dstAsset = toAsset(destAsset.code, destAsset.issuer);

  // ── Discover best path if not supplied ───────────────────────────────────
  let resolvedPath = path;
  let quotedSourceAmount;

  if (!resolvedPath.length) {
    const paths = await findPathsStrictReceive({
      sourceAsset: sendAsset,
      destinationAsset: destAsset,
      destinationAmount: destAmount,
    });
    if (!paths.length) throw new Error('No path found between assets');
    quotedSourceAmount = paths[0].sourceAmount;
    resolvedPath = paths[0].path
      .filter(p => p !== sendAsset.code && p !== destAsset.code)
      .map(code => toAsset(code));
  } else {
    resolvedPath = resolvedPath.map(p => toAsset(p.code || p, p.issuer));
    // Still need a quote to compute sendMax — run a lookup
    const paths = await findPathsStrictReceive({
      sourceAsset: sendAsset,
      destinationAsset: destAsset,
      destinationAmount: destAmount,
    });
    if (!paths.length) throw new Error('No path found between assets');
    quotedSourceAmount = paths[0].sourceAmount;
  }

  // ── Compute sendMax with slippage ceiling (ISSUE-045) ────────────────────
  const sendMax = calculateSendMax(quotedSourceAmount, validatedSlippagePct);

  // ── Balance check: reject if sendMax > available balance (ISSUE-045) ─────
  const account = await withHorizonRetry(() => getHorizonServer().loadAccount(sourcePublicKey));
  const sendAssetBalance = account.balances.find(b =>
    sendAsset.code === 'XLM'
      ? b.asset_type === 'native'
      : b.asset_code === sendAsset.code && b.asset_issuer === (sendAsset.issuer || getIssuer(sendAsset.code))
  );
  const availableBalance = sendAssetBalance ? parseFloat(sendAssetBalance.balance) : 0;

  if (parseFloat(sendMax) > availableBalance) {
    throw new Error(
      `sendMax (${sendMax} ${sendAsset.code}) exceeds available balance ` +
      `(${availableBalance.toFixed(7)} ${sendAsset.code}). ` +
      `Reduce the destination amount or increase your balance.`
    );
  }

  // ── Audit log (ISSUE-045) ─────────────────────────────────────────────────
  logger.info('pathPayment.strictReceive.quote', {
    source: sourcePublicKey,
    destination,
    sendAsset: sendAsset.code,
    destAsset: destAsset.code,
    destAmount,
    quotedSourceAmount,
    sendMax,
    slippageTolerancePercent: validatedSlippagePct,
    slippageBufferAmount: (parseFloat(sendMax) - parseFloat(quotedSourceAmount)).toFixed(7),
    pathHops: path.length || 'auto-discovered',
  });

  // ── Build and submit transaction ──────────────────────────────────────────
  const tx = new StellarSDK.TransactionBuilder(account, {
    fee: StellarSDK.BASE_FEE,
    networkPassphrase: networkPassphrase(),
  })
    .addOperation(StellarSDK.Operation.pathPaymentStrictReceive({
      sendAsset: srcAsset,
      sendMax,
      destination,
      destAsset: dstAsset,
      destAmount: destAmount.toString(),
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
    logger.error('pathPayment.strictReceive.failed', {
      source: sourcePublicKey,
      destination,
      code,
      sendMax,
      error: err.message,
    });
    const mapped = new Error(userMessage);
    mapped.code = code;
    mapped.original = err;
    throw mapped;
  }

  logger.info('pathPayment.strictReceive.success', {
    hash: result.hash,
    source: sourcePublicKey,
    destination,
    sendMax,
    quotedSourceAmount,
    slippageTolerancePercent: validatedSlippagePct,
  });

  await eventMonitor.publishEvent(sourcePublicKey, {
    type: 'PathPaymentStrictReceiveSent',
    data: {
      destination,
      destAmount,
      sendMax,
      quotedSourceAmount,
      slippageTolerancePercent: validatedSlippagePct,
      sendAsset: sendAsset.code,
      destAsset: destAsset.code,
      hash: result.hash,
    },
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
        amount: String(destAmount),
        ledger: result.ledger ?? null,
        successful: result.successful,
        senderId: sender.id,
        recipientId: recipient.id,
      },
    });
  }).catch(err => logger.warn('db.pathPayment.strictReceive.save.failed', { error: err.message }));

  return {
    hash: result.hash,
    ledger: result.ledger,
    success: result.successful,
    sendMax,
    quotedSourceAmount,
    slippageTolerancePercent: validatedSlippagePct,
  };
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
