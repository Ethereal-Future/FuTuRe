/* backend/src/services/streaming.js */
import prisma from '../db/client.js';
import { sendPayment } from './stellar.js';
import { eventMonitor } from '../eventSourcing/index.js';
import logger, { withContext } from '../config/logger.js';
import { encryptToEnvValue, decryptFromEnvValue } from '../config/secrets.js';

/**
 * Per-stream secret encryption/decryption
 * 
 * SECURITY MODEL:
 * - Each PaymentStream stores an encrypted senderSecret
 * - Secrets are encrypted at rest using STREAM_SECRET_ENCRYPTION_KEY
 * - Decryption happens only during payment processing
 * - This is an interim solution before full delegated signing
 * 
 * See STREAMING_SECURITY.md for detailed security trade-offs and future improvements
 */
function getStreamEncryptionKey() {
  const key = process.env.STREAM_SECRET_ENCRYPTION_KEY;
  if (!key) throw new Error('STREAM_SECRET_ENCRYPTION_KEY is not set');
  return key;
}

/**
 * Create a new recurring payment stream with the sender's secret encrypted at rest.
 * @param {object} params
 * @param {string} params.senderPublicKey - Stellar public key of the sender
 * @param {string} params.senderSecret - Plaintext secret key used to sign each interval payment
 * @param {string} params.recipientPublicKey - Stellar public key of the recipient
 * @param {string} [params.assetCode='XLM'] - Asset code to stream
 * @param {number} params.rateAmount - Amount sent per interval
 * @param {number} [params.intervalSeconds=60] - Seconds between each payment
 * @param {string|null} [params.endTime] - ISO date string at which the stream stops
 * @param {object} [params.metadata={}] - Arbitrary metadata attached to the stream record
 * @returns {Promise<import('@prisma/client').PaymentStream>} The newly created stream record
 * @throws {Error} If senderSecret is not provided or Prisma write fails
 * @example
 * const stream = await createStream({
 *   senderPublicKey: 'GABC...',
 *   senderSecret: 'SABC...',
 *   recipientPublicKey: 'GXYZ...',
 *   rateAmount: 1,
 *   intervalSeconds: 3600,
 * });
 */
export async function createStream({ senderPublicKey, senderSecret, recipientPublicKey, assetCode, rateAmount, intervalSeconds = 60, endTime, metadata }) {
  if (!senderSecret) throw new Error('senderSecret is required to create a stream');

  const encryptedSecret = encryptToEnvValue(senderSecret, getStreamEncryptionKey());

  // Ensure users exist
  const [sender, recipient] = await Promise.all([
    prisma.user.upsert({ where: { publicKey: senderPublicKey }, update: {}, create: { publicKey: senderPublicKey } }),
    prisma.user.upsert({ where: { publicKey: recipientPublicKey }, update: {}, create: { publicKey: recipientPublicKey } }),
  ]);

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
      senderSecret: encryptedSecret,
    },
  });

  await eventMonitor.publishEvent(senderPublicKey, {
    type: 'StreamCreated',
    data: { 
      streamId: stream.id, 
      recipientPublicKey, 
      assetCode: assetCode || 'XLM',
      rateAmount, 
      intervalSeconds 
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
  const stream = await prisma.paymentStream.update({
    where: { id },
    data: { status: 'ACTIVE', lastProcessedAt: new Date() },
    include: { sender: true },
  });

  await eventMonitor.publishEvent(stream.sender.publicKey, {
    type: 'StreamResumed',
    data: { streamId: id },
    version: 1,
  });

  return stream;
}

/**
 * Permanently cancel a payment stream. Cancelled streams cannot be resumed.
 * @param {number} id - Primary key of the PaymentStream record
 * @returns {Promise<import('@prisma/client').PaymentStream>} Updated stream record with status 'CANCELLED'
 * @throws {Error} If the stream does not exist or the DB update fails
 */
export async function cancelStream(id) {
  const stream = await prisma.paymentStream.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: { sender: true },
  });

  await eventMonitor.publishEvent(stream.sender.publicKey, {
    type: 'StreamCancelled',
    data: { streamId: id },
    version: 1,
  });

  return stream;
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
  if (updates.rateAmount !== undefined) updateData.rateAmount = updates.rateAmount;
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
 * Worker tick: find all ACTIVE streams whose interval has elapsed and execute the next payment.
 * Streams that fail 5 consecutive times are automatically set to FAILED status.
 * Intended to be called by a scheduled job (e.g. every 10–30 seconds).
 * @returns {Promise<void>}
 */
export async function processActiveStreams() {
  const now = new Date();
  const activeStreams = await prisma.paymentStream.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { endTime: null },
        { endTime: { gt: now } },
      ],
    },
    include: { sender: true, recipient: true },
  });

  logger.debug('streaming.worker.tick', { activeCount: activeStreams.length });

  for (const stream of activeStreams) {
    const lastProcessed = new Date(stream.lastProcessedAt);
    const secondsSinceLast = (now - lastProcessed) / 1000;

    if (secondsSinceLast >= stream.intervalSeconds) {
       try {
         if (!stream.senderSecret) {
           throw new Error('Stream has no senderSecret — cannot sign transaction');
         }
         const senderSecret = decryptFromEnvValue(stream.senderSecret, getStreamEncryptionKey());

         // Execute payment on Stellar using the actual sender's secret
         const result = await sendPayment(
           senderSecret,
           stream.recipient.publicKey, 
           stream.rateAmount.toString(), 
           stream.assetCode
         );
         
         if (result.success) {
           await prisma.paymentStream.update({
             where: { id: stream.id },
             data: {
               lastProcessedAt: now,
               totalStreamed: { increment: stream.rateAmount },
               failureCount: 0,
             },
           });

           await eventMonitor.publishEvent(stream.sender.publicKey, {
             type: 'StreamPaymentProcessed',
             data: { streamId: stream.id, amount: stream.rateAmount, hash: result.hash },
             version: 1,
           });

           withContext(logger, { action: 'processStream', correlationId: stream.id }).info('streaming.process.success', { streamId: stream.id, hash: result.hash });
         } else {
           throw new Error('Transaction submission failed');
         }
       } catch (err) {
         withContext(logger, { action: 'processStream', correlationId: stream.id }).error('streaming.process.failed', { streamId: stream.id, error: err.message });
         
         const updatedStream = await prisma.paymentStream.update({
           where: { id: stream.id },
           data: { failureCount: { increment: 1 } },
         });

         if (updatedStream.failureCount >= 5) {
           await prisma.paymentStream.update({
             where: { id: stream.id },
             data: { status: 'FAILED' },
           });
           
           await eventMonitor.publishEvent(stream.sender.publicKey, {
             type: 'StreamFailed',
             data: { streamId: stream.id, reason: 'Consecutive execution failures' },
             version: 1,
           });

           withContext(logger, { action: 'processStream', correlationId: stream.id }).error('streaming.stream.halted', { streamId: stream.id, reason: 'Too many failures' });
         }
       }
    }
  }
}
