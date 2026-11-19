/* backend/src/services/streaming.js */
import pLimit from 'p-limit';
import prisma from '../db/client.js';
import { eventMonitor } from '../eventSourcing/index.js';
import logger, { withContext } from '../config/logger.js';
import { getSubscriptionByPublicKey, sendWebPush } from '../notifications/webPush.js';
import { createRedisBackend } from '../cache/redis.js';
import { incrementCounter, recordStreamingWorkerDuration } from '../monitoring/metrics.js';
import { createDelegatedStreamEscrow, tickStreamPayment } from './streamContract.js';
import { horizonServer } from '../config/stellar.js';

export { prisma };

/** Consecutive payment failures before a stream is marked FAILED (default 5). */
export const STREAM_MAX_CONSECUTIVE_FAILURES = Math.max(
  1,
  Number.parseInt(process.env.STREAM_MAX_CONSECUTIVE_FAILURES || '5', 10) || 5,
);

const STREAM_LOCK_TTL_SECONDS = 30;
const redisLock = createRedisBackend(process.env.REDIS_URL);
let redisLockConnecting = null;

/**
 * Best-effort cross-instance lock for a stream's payment tick. Fails open when
 * Redis is absent or erroring: the atomic lastProcessedAt claim in
 * claimStreamInterval is the authoritative guard against double payment.
 */
async function acquireStreamLock(streamId, owner) {
  try {
    redisLockConnecting ??= redisLock.connect();
    await redisLockConnecting;
    return await redisLock.setNX(`stream:lock:${streamId}`, owner, STREAM_LOCK_TTL_SECONDS);
  } catch (err) {
    logger.warn('streaming.lock.redis_unavailable', { streamId, error: err.message });
    return true;
  }
}

async function releaseStreamLock(streamId) {
  await redisLock.delete(`stream:lock:${streamId}`);
}

/**
 * Next scheduled tick time: lastProcessedAt + intervalSeconds (fixed cadence).
 * Advancing by the interval — not wall-clock completion time — prevents
 * execution latency from compounding into long-term schedule drift (#1371).
 * When the worker was offline across multiple intervals, each successful
 * payment still advances exactly one slot so subsequent ticks catch up.
 * @param {{ lastProcessedAt: Date|string, intervalSeconds: number }} stream
 * @returns {Date}
 */
export function nextScheduledProcessedAt(stream) {
  return new Date(
    new Date(stream.lastProcessedAt).getTime() + stream.intervalSeconds * 1000,
  );
}

/**
 * Atomically claim the current interval by advancing lastProcessedAt by exactly
 * one intervalSeconds slot, but only if no other worker has advanced it since
 * we read the stream. Exactly one concurrent caller can win this compare-and-set.
 * @returns {Promise<boolean>} true if this worker owns the interval
 */
async function claimStreamInterval(stream, _now) {
  const scheduledTime = nextScheduledProcessedAt(stream);
  const claimed = await prisma.paymentStream.updateMany({
    where: {
      id: stream.id,
      status: 'ACTIVE',
      lastProcessedAt: stream.lastProcessedAt,
    },
    data: { lastProcessedAt: scheduledTime },
  });
  return claimed.count === 1;
}

/**
 * SECURITY MODEL (delegated, non-custodial):
 * - Backend NEVER stores user private keys / senderSecret
 * - Payments release from a Soroban StreamPayment escrow (see stellar-contract/src/stream_payment.rs)
 * - Workers call permissionless tick_stream — key compromise cannot drain the primary account
 *
 * See STREAMING_SECURITY.md
 */

/** Minimum stream rate per interval (avoids dust txs that cost more in fees than value). */
export const MIN_STREAM_RATE_AMOUNT = 0.00001;

/**
 * Validate rateAmount against Stellar SDK constraints (≤7 decimal places / 1 stroop)
 * and a sensible minimum to avoid fee-exceeding dust payments.
 * @param {string|number} rateAmount
 * @throws {Error} with code RATE_AMOUNT_INVALID
 */
export function validateRateAmount(rateAmount) {
  const raw = String(rateAmount).trim();
  if (!/^\d+(\.\d{1,7})?$/.test(raw)) {
    const err = new Error('rateAmount cannot exceed 7 decimal places (1 stroop)');
    err.code = 'RATE_AMOUNT_INVALID';
    throw err;
  }
  const value = parseFloat(raw);
  if (!(value >= MIN_STREAM_RATE_AMOUNT)) {
    const err = new Error(
      `rateAmount must be at least ${MIN_STREAM_RATE_AMOUNT} to avoid dust payments`,
    );
    err.code = 'RATE_AMOUNT_INVALID';
    throw err;
  }
  return value;
}

/** Smallest prorated settlement we will execute (1 stroop). */
export const MIN_PRORATED_SETTLEMENT = 0.0000001;

/** Native Stellar assets do not require a trustline. */
const NATIVE_ASSET_CODES = new Set(['', 'XLM', 'NATIVE']);

/**
 * @param {string} [assetCode]
 * @returns {boolean} true when the asset is the native XLM asset
 */
export function isNativeAsset(assetCode) {
  return NATIVE_ASSET_CODES.has(String(assetCode ?? '').toUpperCase());
}

/**
 * Locate a balance/trustline entry for an asset on a Horizon account response.
 * @param {object} account Horizon account record
 * @param {string} assetCode
 * @returns {object|undefined}
 */
function findAssetBalance(account, assetCode) {
  const code = String(assetCode).toUpperCase();
  return (account?.balances || []).find(
    (b) => String(b.asset_code ?? '').toUpperCase() === code,
  );
}

/**
 * Pre-flight validation for stream creation. Rejects non-viable streams before
 * they are persisted as ACTIVE so the first worker tick cannot fail on
 * op_no_trust / op_underfunded.
 *
 * For non-native assets:
 *  - the sender must hold the asset with a balance of at least one interval
 *  - the recipient must have an established trustline for the asset
 *
 * @param {object} params
 * @param {string} params.senderPublicKey
 * @param {string} params.recipientPublicKey
 * @param {string} [params.assetCode]
 * @param {number} params.rateAmount
 * @throws {Error} code STREAM_SENDER_BALANCE_INSUFFICIENT | STREAM_RECIPIENT_TRUSTLINE_MISSING | STREAM_PREFLIGHT_HORIZON_ERROR
 */
export async function validateStreamPreflight({
  senderPublicKey,
  recipientPublicKey,
  assetCode,
  rateAmount,
}) {
  if (isNativeAsset(assetCode)) return;

  const code = String(assetCode).toUpperCase();

  let senderAccount;
  let recipientAccount;
  try {
    [senderAccount, recipientAccount] = await Promise.all([
      horizonServer.loadAccount(senderPublicKey),
      horizonServer.loadAccount(recipientPublicKey),
    ]);
  } catch (err) {
    const e = new Error(
      `Unable to verify stream viability on Horizon: ${err.message}`,
    );
    e.code = 'STREAM_PREFLIGHT_HORIZON_ERROR';
    throw e;
  }

  const senderBalance = findAssetBalance(senderAccount, code);
  if (!senderBalance) {
    const e = new Error(`Sender does not hold ${code}; cannot fund this stream`);
    e.code = 'STREAM_SENDER_BALANCE_INSUFFICIENT';
    throw e;
  }
  if (Number(senderBalance.balance) < Number(rateAmount)) {
    const e = new Error(
      `Sender ${code} balance (${senderBalance.balance}) is below the stream rate (${rateAmount})`,
    );
    e.code = 'STREAM_SENDER_BALANCE_INSUFFICIENT';
    throw e;
  }

  const recipientTrustline = findAssetBalance(recipientAccount, code);
  if (!recipientTrustline) {
    const e = new Error(`Recipient has no trustline for ${code}`);
    e.code = 'STREAM_RECIPIENT_TRUSTLINE_MISSING';
    throw e;
  }
  const limit = Number(recipientTrustline.limit);
  const held = Number(recipientTrustline.balance || 0);
  if (Number.isFinite(limit) && limit - held < Number(rateAmount)) {
    const e = new Error(
      `Recipient ${code} trustline limit (${recipientTrustline.limit}) is too low to receive the stream rate (${rateAmount})`,
    );
    e.code = 'STREAM_RECIPIENT_TRUSTLINE_INSUFFICIENT';
    throw e;
  }
}

/**
 * Create a new recurring payment stream backed by Soroban escrow (no stored secrets).
 * @param {object} params
 * @param {string} params.senderPublicKey - Stellar public key of the sender
 * @param {string} params.recipientPublicKey - Stellar public key of the recipient
 * @param {string} params.escrowContractId - Deployed StreamPayment contract (C...)
 * @param {string|number} params.contractStreamId - On-chain stream id in the escrow
 * @param {string} [params.senderSecret] - REJECTED; must not be provided
 * @param {string} [params.assetCode='XLM'] - Asset code to stream
 * @param {number} params.rateAmount - Amount sent per interval
 * @param {number} [params.intervalSeconds=60] - Seconds between each payment
 * @param {string|null} [params.endTime] - ISO date string at which the stream stops
 * @param {object} [params.metadata={}] - Arbitrary metadata attached to the stream record
 * @param {string|number} [params.allowance] - Escrowed allowance
 * @returns {Promise<import('@prisma/client').PaymentStream>} The newly created stream record
 */
export async function createStream({
  senderPublicKey,
  senderSecret,
  recipientPublicKey,
  assetCode,
  rateAmount,
  intervalSeconds = 60,
  endTime,
  metadata,
  escrowContractId,
  contractStreamId,
  allowance,
}) {
  if (senderSecret) {
    const err = new Error(
      'senderSecret is no longer accepted; use delegated Soroban escrow (escrowContractId + contractStreamId)',
    );
    err.code = 'CUSTODIAL_SECRET_REJECTED';
    throw err;
  }

  rateAmount = validateRateAmount(rateAmount);

  // Pre-flight: reject streams that cannot possibly pay for non-native assets
  // (missing sender balance / recipient trustline) before marking them ACTIVE.
  await validateStreamPreflight({
    senderPublicKey,
    recipientPublicKey,
    assetCode,
    rateAmount,
  });

  const delegated = await createDelegatedStreamEscrow({
    senderPublicKey,
    recipientPublicKey,
    escrowContractId,
    contractStreamId,
    rateAmount,
    intervalSeconds,
    allowance,
  });

  // Ensure users exist
  const [sender, recipient] = await Promise.all([
    prisma.user.upsert({ where: { publicKey: senderPublicKey }, update: {}, create: { publicKey: senderPublicKey } }),
    prisma.user.upsert({ where: { publicKey: recipientPublicKey }, update: {}, create: { publicKey: recipientPublicKey } }),
  ]);

  const maxStreams = parseInt(process.env.MAX_STREAMS_PER_USER ?? '10', 10);
  const activeCount = await prisma.paymentStream.count({
    where: { senderId: sender.id, status: 'ACTIVE' },
  });
  if (activeCount >= maxStreams) {
    const err = new Error(`Active stream limit reached (max ${maxStreams} per user)`);
    err.code = 'STREAM_LIMIT_EXCEEDED';
    throw err;
  }

  const stream = await prisma.paymentStream.create({
    data: {
      senderId: sender.id,
      recipientId: recipient.id,
      assetCode: assetCode || 'XLM',
      rateAmount,
      intervalSeconds,
      endTime: endTime ? new Date(endTime) : null,
      metadata: metadata || {},
      status: 'ACTIVE',
      senderSecret: null,
      escrowContractId: delegated.escrowContractId,
      contractStreamId: delegated.contractStreamId,
    },
  });

  await eventMonitor.publishEvent(senderPublicKey, {
    type: 'StreamCreated',
    data: {
      streamId: stream.id,
      recipientPublicKey,
      assetCode: assetCode || 'XLM',
      rateAmount,
      intervalSeconds,
      escrowContractId: delegated.escrowContractId,
      contractStreamId: delegated.contractStreamId,
    },
    version: 1,
  });

  return stream;
}

/**
 * Pause an active payment stream, halting interval payments until resumed.
 * @param {number} id - Primary key of the PaymentStream record
 * @returns {Promise<import('@prisma/client').PaymentStream>} Updated stream record with status 'PAUSED'
 * @throws {Error} If the stream does not exist or the DB update fails
 */
export async function pauseStream(id) {
  const stream = await prisma.paymentStream.update({
    where: { id },
    data: { status: 'PAUSED' },
    include: { sender: true },
  });

  await eventMonitor.publishEvent(stream.sender.publicKey, {
    type: 'StreamPaused',
    data: { streamId: id },
    version: 1,
  });

  return stream;
}

/**
 * Resume a paused payment stream.
 * @param {number} id - Primary key of the PaymentStream record
 * @returns {Promise<import('@prisma/client').PaymentStream>} Updated stream record with status 'ACTIVE'
 * @throws {Error} If the stream does not exist or the DB update fails
 */
export async function resumeStream(id) {
  const stream = await prisma.paymentStream.findUnique({ where: { id }, include: { sender: true } });
  if (!stream) throw new Error('Stream not found');
  if (!['PAUSED', 'FAILED'].includes(stream.status)) {
    throw new Error(`Cannot resume stream with status ${stream.status}`);
  }

  const updated = await prisma.paymentStream.update({
    where: { id },
    data: { status: 'ACTIVE', lastProcessedAt: new Date(), failureCount: 0, nextAttemptAt: null },
    include: { sender: true },
  });

  await eventMonitor.publishEvent(stream.sender.publicKey, {
    type: 'StreamResumed',
    data: { streamId: id },
    version: 1,
  });

  return updated;
}

/**
 * Compute the prorated amount owed for the elapsed portion of the current
 * active interval. Capped at one full interval and rounded down to 7 decimal
 * places (Stellar's maximum precision).
 * @param {import('@prisma/client').PaymentStream} stream
 * @returns {Promise<{amount: number, hash: string|null}>}
 */
async function computeProratedSettlement(stream) {
  const intervalSeconds = Number(stream.intervalSeconds) || 0;
  if (intervalSeconds <= 0) return { amount: 0, hash: null };

  const elapsedSeconds = (Date.now() - new Date(stream.lastProcessedAt).getTime()) / 1000;
  if (!(elapsedSeconds > 0)) return { amount: 0, hash: null };

  const rate = Number(stream.rateAmount);
  let amount = (rate * elapsedSeconds) / intervalSeconds;
  amount = Math.min(amount, rate);
  amount = Math.floor(amount * 1e7) / 1e7;

  if (amount < MIN_PRORATED_SETTLEMENT) return { amount: 0, hash: null };

  let hash = null;
  if (stream.escrowContractId && stream.contractStreamId) {
    const result = await tickStreamPayment(stream.escrowContractId, stream.contractStreamId);
    if (!result || result.success === false) {
      const err = new Error('Prorated settlement payment failed');
      err.code = 'STREAM_PRORATED_SETTLEMENT_FAILED';
      throw err;
    }
    hash = result.hash ?? null;
  }

  return { amount, hash };
}

/**
 * Permanently cancel a payment stream. Cancelled streams cannot be resumed.
 * @param {number} id - Primary key of the PaymentStream record
 * @param {{settleProrated?: boolean}} [options] - When settleProrated is true, a
 *   final prorated payment is released for the elapsed portion of the current interval.
 * @returns {Promise<import('@prisma/client').PaymentStream>} Updated stream record with status 'CANCELLED'
 * @throws {Error} If the stream does not exist or the DB update fails
 */
export async function cancelStream(id, options = {}) {
  const { settleProrated = false } = typeof options === 'boolean' ? { settleProrated: options } : options;

  const existing = await prisma.paymentStream.findUnique({
    where: { id },
    include: { sender: true },
  });
  if (!existing) throw new Error('Stream not found');

  let settlement = { amount: 0, hash: null };
  if (settleProrated) {
    settlement = await computeProratedSettlement(existing);
  }

  const updateData = { status: 'CANCELLED' };
  if (settlement.amount >= MIN_PRORATED_SETTLEMENT) {
    updateData.totalStreamed = { increment: settlement.amount };
    updateData.lastProcessedAt = new Date();
  }

  const stream = await prisma.paymentStream.update({
    where: { id },
    data: updateData,
    include: { sender: true },
  });

  if (settlement.amount >= MIN_PRORATED_SETTLEMENT) {
    await eventMonitor.publishEvent(stream.sender.publicKey, {
      type: 'StreamSettled',
      data: {
        streamId: id,
        amount: settlement.amount,
        prorated: true,
        hash: settlement.hash,
      },
      version: 1,
    });
  }

  await eventMonitor.publishEvent(stream.sender.publicKey, {
    type: 'StreamCancelled',
    data: { streamId: id, settlementAmount: settlement.amount },
    version: 1,
  });

  return stream;
}

/**
 * Cancel every active or paused payment stream originating from a sender account.
 * Used by compliance holds to immediately halt outgoing capital flow.
 * @param {string} senderPublicKey - Stellar public key of the stream sender
 * @returns {Promise<{cancelled: number, streamIds: number[]}>} Summary of cancelled streams
 */
export async function cancelStreamsForSender(senderPublicKey) {
  if (!senderPublicKey) return { cancelled: 0, streamIds: [] };

  const sender = await prisma.user.findUnique({ where: { publicKey: senderPublicKey } });
  if (!sender) return { cancelled: 0, streamIds: [] };

  const streams = await prisma.paymentStream.findMany({
    where: { senderId: sender.id, status: { in: ['ACTIVE', 'PAUSED'] } },
    select: { id: true },
  });

  const streamIds = [];
  for (const { id } of streams) {
    try {
      await cancelStream(id);
      streamIds.push(id);
    } catch (err) {
      logger.error(`Failed to cancel stream ${id} for compliance hold`, { error: err.message, senderPublicKey });
    }
  }

  return { cancelled: streamIds.length, streamIds };
}

/**
 * Update mutable fields of an active or paused stream.
 * @param {number} id - Primary key of the PaymentStream record
 * @param {object} updates
 * @param {number} [updates.rateAmount] - New payment amount per interval
 * @param {number} [updates.intervalSeconds] - New interval in seconds
 * @param {string|null} [updates.endTime] - New ISO end-time string, or null to remove the end time
 * @returns {Promise<import('@prisma/client').PaymentStream>} Updated stream record
 * @throws {Error} If the stream is not found, or has a non-updatable status (CANCELLED/FAILED/COMPLETED)
 */
export async function updateStream(id, updates) {
  const stream = await prisma.paymentStream.findUnique({
    where: { id },
    include: { sender: true },
  });

  if (!stream) throw new Error('Stream not found');
  if (!['ACTIVE', 'PAUSED'].includes(stream.status)) {
    throw new Error(`Cannot update stream with status ${stream.status}`);
  }

  const updateData = {};
  if (updates.rateAmount !== undefined) updateData.rateAmount = validateRateAmount(updates.rateAmount);
  if (updates.intervalSeconds !== undefined) updateData.intervalSeconds = updates.intervalSeconds;
  if (updates.endTime !== undefined) updateData.endTime = updates.endTime ? new Date(updates.endTime) : null;

  const updated = await prisma.paymentStream.update({
    where: { id },
    data: updateData,
    include: { sender: true },
  });

  await eventMonitor.publishEvent(stream.sender.publicKey, {
    type: 'StreamUpdated',
    data: { streamId: id, updates: updateData },
    version: 1,
  });

  return updated;
}


/**
 * Return aggregate analytics across all payment streams.
 * @returns {Promise<{totalVolume: string, activeStreams: number, pausedStreams: number, failedStreams: number, completedStreams: number, cancelledStreams: number, totalStreams: number, topAssets: Array<{assetCode: string, count: number}>}>}
 */
export async function getStreamAnalytics() {
  const [statusCounts, totalVolumeResult, assets] = await Promise.all([
    prisma.paymentStream.groupBy({
      by: ['status'],
      _count: true,
    }),
    prisma.paymentStream.aggregate({
      _sum: { totalStreamed: true },
    }),
    prisma.paymentStream.groupBy({
      by: ['assetCode'],
      _count: true,
      orderBy: { _count: { assetCode: 'desc' } },
      take: 10,
    }),
  ]);

  const statusMap = statusCounts.reduce((acc, { status, _count }) => {
    acc[status] = _count;
    return acc;
  }, {});

  return {
    totalVolume: (totalVolumeResult._sum.totalStreamed || 0).toFixed(7),
    activeStreams: statusMap.ACTIVE || 0,
    pausedStreams: statusMap.PAUSED || 0,
    failedStreams: statusMap.FAILED || 0,
    completedStreams: statusMap.COMPLETED || 0,
    cancelledStreams: statusMap.CANCELLED || 0,
    totalStreams: Object.values(statusMap).reduce((a, b) => a + b, 0),
    topAssets: assets.map(a => ({ assetCode: a.assetCode, count: a._count })),
  };
}

/**
 * Return the failure history for a given stream, most recent first.
 * @param {string} id - Primary key of the PaymentStream record
 * @returns {Promise<Array<{id: string, streamId: string, reason: string, createdAt: Date}>>}
 */
export async function getStreamFailures(id) {
  return prisma.streamFailure.findMany({
    where: { streamId: id },
    orderBy: { createdAt: 'desc' },
  });
}

const STREAM_WORKER_CONCURRENCY = 5;

/**
 * Process a single due payment stream (lock, claim, pay, record outcome).
 * @param {object} stream
 * @param {Date} now
 * @returns {Promise<boolean>} true if a payment attempt was made
 */
export async function processSingleStream(stream, now = new Date()) {
  const lastProcessed = new Date(stream.lastProcessedAt);
  const secondsSinceLast = (now - lastProcessed) / 1000;

  if (secondsSinceLast < stream.intervalSeconds) return false;

  const lockOwner = `${process.pid}:${now.getTime()}`;
  if (!(await acquireStreamLock(stream.id, lockOwner))) {
    incrementCounter('stream_payment_claim_conflicts_total');
    logger.debug('streaming.process.locked', { streamId: stream.id });
    return false;
  }

  try {
    // Claim before paying. The claim is deliberately not reverted on failure:
    // a submission error can be ambiguous (the tx may have landed), so the
    // retry waits for the next interval rather than risking a double send.
    // Failures are still recorded and the stream halts after STREAM_MAX_CONSECUTIVE_FAILURES.
    if (!(await claimStreamInterval(stream, now))) {
      incrementCounter('stream_payment_claim_conflicts_total');
      logger.debug('streaming.process.already_claimed', { streamId: stream.id });
      return false;
    }

    try {
      if (!stream.escrowContractId || !stream.contractStreamId) {
        throw new Error('Stream missing delegated escrow references — cannot tick without user secret storage');
      }

      // Release one interval from Soroban escrow — no user private key involved
      const result = await tickStreamPayment(stream.escrowContractId, stream.contractStreamId);

      if (result.success) {
        await prisma.paymentStream.update({
          where: { id: stream.id },
          data: {
            totalStreamed: { increment: stream.rateAmount },
            failureCount: 0,
            nextAttemptAt: null,
          },
        });

        await eventMonitor.publishEvent(stream.sender.publicKey, {
          type: 'StreamPaymentProcessed',
          data: { streamId: stream.id, amount: stream.rateAmount, hash: result.hash },
          version: 1,
        });

        withContext(logger, { action: 'processStream', correlationId: stream.id }).info('streaming.process.success', { streamId: stream.id, hash: result.hash });
        incrementCounter('active_streams_processed_total');
        return true;
      }
      throw new Error('Transaction submission failed');
    } catch (err) {
      withContext(logger, { action: 'processStream', correlationId: stream.id }).error('streaming.process.failed', { streamId: stream.id, error: err.message });

      await prisma.streamFailure.create({
        data: { streamId: stream.id, reason: err.message },
      });

      const updatedStream = await prisma.paymentStream.update({
        where: { id: stream.id },
        data: { failureCount: { increment: 1 } },
      });

      // Exponential backoff: intervalSeconds * 2^failureCount so transient
      // Horizon/network glitches do not burn through the retry allowance.
      const backoffSeconds = Math.min(
        stream.intervalSeconds * Math.pow(2, updatedStream.failureCount),
        3600,
      );
      await prisma.paymentStream.update({
        where: { id: stream.id },
        data: { nextAttemptAt: new Date(Date.now() + backoffSeconds * 1000) },
      });

      if (updatedStream.failureCount >= STREAM_MAX_CONSECUTIVE_FAILURES) {
        await prisma.paymentStream.update({
          where: { id: stream.id },
          data: { status: 'FAILED' },
        });

        const subscription = getSubscriptionByPublicKey(stream.sender.publicKey);
        if (subscription) {
          await sendWebPush(subscription, {
            title: 'Payment stream failed',
            body: `Your payment stream failed after ${STREAM_MAX_CONSECUTIVE_FAILURES} consecutive errors: ${err.message}`,
            data: { streamId: stream.id, reason: err.message },
          });
        }

        await eventMonitor.publishEvent(stream.sender.publicKey, {
          type: 'StreamFailed',
          data: { streamId: stream.id, reason: err.message },
          version: 1,
        });

        withContext(logger, { action: 'processStream', correlationId: stream.id }).error('streaming.stream.halted', { streamId: stream.id, reason: err.message });
      }
      incrementCounter('active_streams_processed_total');
      return true;
    }
  } finally {
    await releaseStreamLock(stream.id);
  }
}

/**
 * Worker tick: find all ACTIVE streams whose interval has elapsed and execute the next payment.
 * Streams that fail STREAM_MAX_CONSECUTIVE_FAILURES consecutive times are automatically set to FAILED.
 * Due streams are processed in parallel with bounded concurrency (p-limit) so a slow Horizon
 * call does not delay the rest of the tick window.
 * Intended to be called by a scheduled job (e.g. every 10–30 seconds).
 * @returns {Promise<void>}
 */
export async function processActiveStreams() {
  const tickStarted = Date.now();
  const now = new Date();
  const activeStreams = await prisma.paymentStream.findMany({
    where: {
      status: 'ACTIVE',
      AND: [
        {
          OR: [
            { endTime: null },
            { endTime: { gt: now } },
          ],
        },
        {
          OR: [
            { nextAttemptAt: null },
            { nextAttemptAt: { lte: now } },
          ],
        },
      ],
    },
    include: { sender: true, recipient: true },
  });

  const dueStreams = activeStreams.filter((stream) => {
    const lastProcessed = new Date(stream.lastProcessedAt);
    return (now - lastProcessed) / 1000 >= stream.intervalSeconds;
  });

  logger.debug('streaming.worker.tick', {
    activeCount: activeStreams.length,
    dueCount: dueStreams.length,
  });

  const limit = pLimit(STREAM_WORKER_CONCURRENCY);
  await Promise.allSettled(dueStreams.map((stream) => limit(() => processSingleStream(stream, now))));

  recordStreamingWorkerDuration((Date.now() - tickStarted) / 1000);
}
