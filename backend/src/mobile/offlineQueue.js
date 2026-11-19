import crypto from 'crypto';
import * as StellarSDK from '@stellar/stellar-sdk';
import { horizonServer, networkPassphrase } from '../config/stellar.js';
import * as StellarService from '../services/stellar.js';
import prisma from '../db/client.js';
import { createRedisBackend } from '../cache/redis.js';
import logger from '../config/logger.js';

const REDIS_QUEUE_PREFIX = 'mobile:queue:';
const REDIS_QUEUE_TTL_SECONDS = 60 * 60 * 24;

/** Maximum number of pending items a single user may keep queued. */
export const MAX_OFFLINE_QUEUE_ITEMS = 50;
/** Maximum serialized size of a single queued transaction (bytes). */
export const MAX_PAYLOAD_BYTES = 10_000;

/**
 * Validate that a transaction payload is within the accepted byte budget.
 * @param {unknown} transaction
 * @throws {Error} code OFFLINE_QUEUE_PAYLOAD_TOO_LARGE
 */
export function validatePayloadSize(transaction) {
  const bytes = Buffer.byteLength(JSON.stringify(transaction ?? null), 'utf8');
  if (bytes > MAX_PAYLOAD_BYTES) {
    const err = new Error(
      `Offline transaction payload too large (max ${MAX_PAYLOAD_BYTES} bytes)`,
    );
    err.code = 'OFFLINE_QUEUE_PAYLOAD_TOO_LARGE';
    throw err;
  }
  return bytes;
}

/**
 * Offline transaction queue.
 * Clients enqueue transactions while offline; the server processes them
 * in order when the client reconnects and calls /mobile/queue/flush.
 *
 * The in-memory Map is a hot cache only. Every item is also persisted to
 * PostgreSQL (source of truth) and mirrored to Redis so that a flush request
 * handled by a different cluster instance can still see and process it.
 * See issue #1376.
 */
class OfflineQueue {
  constructor() {
    // userId -> ordered array of queued transactions
    this.queues = new Map();
    // Durability can be disabled in tests / degraded environments.
    this.persistenceEnabled = true;
    this.redis = createRedisBackend(process.env.REDIS_URL);
    this._redisReady = null;
  }

  async _redisClient() {
    if (!this.persistenceEnabled) return null;
    try {
      this._redisReady ??= this.redis.connect();
      await this._redisReady;
      return this.redis;
    } catch {
      return null;
    }
  }

  /** Persist a newly enqueued item to PostgreSQL (best-effort). */
  async _persistEnqueue(item) {
    if (!this.persistenceEnabled) return;
    try {
      await prisma.mobileOfflineQueueItem.create({
        data: {
          id: item.id,
          userId: item.userId,
          transactionData: item.transaction,
          status: item.status,
          enqueuedAt: item.enqueuedAt,
        },
      });
    } catch (err) {
      logger.warn('offlineQueue.persist.enqueue.failed', {
        userId: item.userId,
        error: err.message,
      });
    }
    await this._mirrorToRedis(item.userId);
  }

  /** Mirror the in-memory queue to Redis for fast cross-instance reads. */
  async _mirrorToRedis(userId) {
    const client = await this._redisClient();
    if (!client) return;
    try {
      await client.set(
        `${REDIS_QUEUE_PREFIX}${userId}`,
        this.getQueue(userId),
        REDIS_QUEUE_TTL_SECONDS,
      );
    } catch (err) {
      logger.warn('offlineQueue.redis.mirror.failed', { userId, error: err.message });
    }
  }

  /**
   * Load pending items for a user from PostgreSQL into the in-memory cache.
   * Adds any items not already present. Idempotent and safe to call on every
   * flush so any cluster node can process a user's queue.
   */
  async hydrate(userId) {
    if (!this.persistenceEnabled) return this.getQueue(userId);

    let rows = [];
    try {
      rows = await prisma.mobileOfflineQueueItem.findMany({
        where: { userId, status: 'pending' },
        orderBy: { enqueuedAt: 'asc' },
      });
    } catch (err) {
      logger.warn('offlineQueue.hydrate.failed', { userId, error: err.message });
      return this.getQueue(userId);
    }

    const queue = this.queues.get(userId) || [];
    const known = new Set(queue.map((i) => i.id));
    for (const row of rows) {
      if (known.has(row.id)) continue;
      known.add(row.id);
      queue.push({
        id: row.id,
        userId: row.userId,
        transaction: row.transactionData,
        enqueuedAt: row.enqueuedAt,
        status: row.status,
        result: row.result ?? null,
        processedAt: row.processedAt ?? null,
      });
    }
    queue.sort((a, b) => new Date(a.enqueuedAt) - new Date(b.enqueuedAt));
    this.queues.set(userId, queue);
    return queue;
  }

  enqueue(userId, transaction) {
    validatePayloadSize(transaction);

    if (!this.queues.has(userId)) this.queues.set(userId, []);
    const pendingCount = this.queues
      .get(userId)
      .filter((i) => i.status === 'pending').length;
    if (pendingCount >= MAX_OFFLINE_QUEUE_ITEMS) {
      const err = new Error(
        `Offline queue limit reached (max ${MAX_OFFLINE_QUEUE_ITEMS} items)`,
      );
      err.code = 'OFFLINE_QUEUE_LIMIT_EXCEEDED';
      throw err;
    }

    const item = {
      id: crypto.randomUUID(),
      userId,
      transaction,
      enqueuedAt: new Date(),
      status: 'pending',
    };
    this.queues.get(userId).push(item);
    // Fire-and-forget durable write; memory queue remains the fast path.
    Promise.resolve(this._persistEnqueue(item)).catch(() => {});
    return item;
  }

  getQueue(userId) {
    return this.queues.get(userId) || [];
  }

  async _persistStatus(item) {
    if (!this.persistenceEnabled) return;
    try {
      await prisma.mobileOfflineQueueItem.update({
        where: { id: item.id },
        data: {
          status: item.status,
          result: item.result ?? null,
          error: item.result?.error ?? null,
          processedAt: item.processedAt ?? null,
        },
      });
    } catch (err) {
      logger.warn('offlineQueue.persist.status.failed', {
        userId: item.userId,
        error: err.message,
      });
    }
    await this._mirrorToRedis(item.userId);
  }

  /** Mark an item as processed (success or failed) */
  updateStatus(userId, itemId, status, result = null) {
    const queue = this.queues.get(userId) || [];
    const item = queue.find(i => i.id === itemId);
    if (!item) throw new Error('Queue item not found');
    item.status = status;
    item.result = result;
    item.processedAt = new Date();
    Promise.resolve(this._persistStatus(item)).catch(() => {});
    return item;
  }

  /** Remove completed/failed items */
  clearProcessed(userId) {
    const queue = this.queues.get(userId) || [];
    const pending = queue.filter(i => i.status === 'pending');
    this.queues.set(userId, pending);
    if (this.persistenceEnabled) {
      Promise.resolve(
        prisma.mobileOfflineQueueItem
          .deleteMany({ where: { userId, status: { not: 'pending' } } })
          .then(() => this._mirrorToRedis(userId)),
      ).catch(() => {});
    }
    return { removed: queue.length - pending.length };
  }

  /**
   * Classify a queued transaction as a client-signed XDR or an unsigned /
   * server-signed payment intent.
   */
  classifyTransaction(tx) {
    if (!tx || typeof tx !== 'object') return { kind: 'unknown' };
    if (tx.signedXdr || (tx.xdr && tx.signed !== false && !tx.sourceSecret)) {
      return { kind: 'signed_xdr', xdr: tx.signedXdr || tx.xdr };
    }
    if (tx.sourceSecret && tx.destination && tx.amount != null) {
      return { kind: 'server_signed', ...tx };
    }
    if (tx.destination && tx.amount != null && (tx.sourcePublicKey || tx.publicKey)) {
      return {
        kind: 'unsigned_intent',
        sourcePublicKey: tx.sourcePublicKey || tx.publicKey,
        destination: tx.destination,
        amount: tx.amount,
        assetCode: tx.assetCode || 'XLM',
      };
    }
    return { kind: 'unknown' };
  }

  /**
   * Extract the source account public key and embedded sequence from a
   * queued transaction, when available.
   */
  inspectTransaction(tx) {
    const classified = this.classifyTransaction(tx);
    if (classified.kind === 'signed_xdr') {
      const transaction = StellarSDK.TransactionBuilder.fromXDR(
        classified.xdr,
        networkPassphrase,
      );
      return {
        kind: 'signed_xdr',
        sourcePublicKey: transaction.source,
        embeddedSequence: BigInt(transaction.sequence),
        xdr: classified.xdr,
        transaction,
        hasSignatures: (transaction.signatures?.length ?? 0) > 0,
      };
    }
    if (classified.kind === 'server_signed') {
      const kp = StellarSDK.Keypair.fromSecret(classified.sourceSecret);
      return {
        kind: 'server_signed',
        sourcePublicKey: kp.publicKey(),
        embeddedSequence: tx.sequence != null ? BigInt(tx.sequence) : null,
        ...classified,
      };
    }
    if (classified.kind === 'unsigned_intent') {
      return {
        kind: 'unsigned_intent',
        sourcePublicKey: classified.sourcePublicKey,
        embeddedSequence: tx.sequence != null ? BigInt(tx.sequence) : null,
        ...classified,
      };
    }
    return { kind: 'unknown' };
  }

  /**
   * Flush pending queue items with pre-flight sequence verification.
   * Detects sequence drift before Horizon submission and either re-sequences
   * server-signed intents or returns SEQUENCE_MISMATCH re-sign prompts for
   * client-signed XDRs that cannot be mutated without a new signature.
   *
   * @param {string} userId
   * @param {{ submitPayment?: Function, loadAccount?: Function }} [deps]
   * @returns {Promise<{ processed: number, results: object[], requiresResign: boolean, sequenceDrift?: object }>}
   */
  async flushQueue(userId, deps = {}) {
    const submitPayment = deps.submitPayment || StellarService.sendPayment.bind(StellarService);
    const loadAccount =
      deps.loadAccount || ((publicKey) => horizonServer.loadAccount(publicKey));

    // Rehydrate from PostgreSQL so any cluster instance can flush this user's
    // queue, even if it was enqueued on a different node (issue #1376).
    await this.hydrate(userId);

    const pending = this.getQueue(userId).filter(i => i.status === 'pending');
    const results = [];
    let requiresResign = false;
    let sequenceDrift = null;
    /** @type {Map<string, bigint>} live sequence cursor per account */
    const liveSequences = new Map();

    const getLiveSequence = async (publicKey) => {
      if (liveSequences.has(publicKey)) return liveSequences.get(publicKey);
      const account = await loadAccount(publicKey);
      // Horizon sequence is the last used sequence; next tx must use +1
      const nextSeq = BigInt(account.sequenceNumber()) + 1n;
      liveSequences.set(publicKey, nextSeq);
      return nextSeq;
    };

    for (const item of pending) {
      try {
        const inspected = this.inspectTransaction(item.transaction);

        if (inspected.kind === 'unknown') {
          throw new Error('Unrecognized queued transaction format');
        }

        const liveSeq = await getLiveSequence(inspected.sourcePublicKey);
        const driftDetected =
          inspected.embeddedSequence != null && inspected.embeddedSequence !== liveSeq;

        if (driftDetected || (inspected.kind === 'signed_xdr' && inspected.embeddedSequence !== liveSeq)) {
          if (inspected.kind === 'signed_xdr' && inspected.hasSignatures) {
            // Cannot mutate signed XDR without invalidating signatures
            const drift = {
              code: 'SEQUENCE_MISMATCH',
              account: inspected.sourcePublicKey,
              expectedSequence: liveSeq.toString(),
              embeddedSequence: inspected.embeddedSequence?.toString() ?? null,
              drift: inspected.embeddedSequence != null
                ? (liveSeq - inspected.embeddedSequence).toString()
                : null,
              queueItemId: item.id,
              resignPayload: {
                originalXdr: inspected.xdr,
                suggestedSequence: liveSeq.toString(),
                remainingQueueItemIds: pending
                  .filter(i => i.status === 'pending')
                  .slice(pending.indexOf(item))
                  .map(i => i.id),
              },
            };

            this.updateStatus(userId, item.id, 'SEQUENCE_MISMATCH', drift);
            results.push({
              id: item.id,
              status: 'SEQUENCE_MISMATCH',
              error: 'Sequence number drift detected; client re-signature required',
              sequenceDrift: drift,
            });
            requiresResign = true;
            sequenceDrift = drift;
            // Do not permanently halt — mark remaining pending items as needing re-sign
            // but leave them pending so the client can replace/re-sign and flush again.
            break;
          }

          // Server-signed / unsigned intents: rebuild with current live sequence
          // by letting sendPayment load the account fresh (or pass through).
        }

        if (inspected.kind === 'signed_xdr') {
          // Sequence matches — submit the signed envelope as-is
          const result = await horizonServer.submitTransaction(inspected.transaction);
          this.updateStatus(userId, item.id, 'success', result);
          results.push({ id: item.id, status: 'success', hash: result.hash });
          liveSequences.set(inspected.sourcePublicKey, liveSeq + 1n);
        } else if (inspected.kind === 'server_signed') {
          const result = await submitPayment(
            inspected.sourceSecret,
            inspected.destination,
            String(inspected.amount),
            inspected.assetCode || 'XLM',
          );
          this.updateStatus(userId, item.id, 'success', result);
          results.push({ id: item.id, status: 'success', hash: result.hash });
          liveSequences.set(inspected.sourcePublicKey, liveSeq + 1n);
        } else if (inspected.kind === 'unsigned_intent') {
          // Unsigned intents require client signing — surface as re-sign prompt
          const drift = {
            code: 'SEQUENCE_MISMATCH',
            account: inspected.sourcePublicKey,
            expectedSequence: liveSeq.toString(),
            embeddedSequence: inspected.embeddedSequence?.toString() ?? null,
            queueItemId: item.id,
            resignPayload: {
              intent: {
                sourcePublicKey: inspected.sourcePublicKey,
                destination: inspected.destination,
                amount: String(inspected.amount),
                assetCode: inspected.assetCode || 'XLM',
              },
              suggestedSequence: liveSeq.toString(),
            },
          };
          this.updateStatus(userId, item.id, 'SEQUENCE_MISMATCH', drift);
          results.push({
            id: item.id,
            status: 'SEQUENCE_MISMATCH',
            error: 'Unsigned intent requires client signature with current sequence',
            sequenceDrift: drift,
          });
          requiresResign = true;
          sequenceDrift = drift;
          break;
        }
      } catch (e) {
        this.updateStatus(userId, item.id, 'failed', { error: e.message });
        results.push({ id: item.id, status: 'failed', error: e.message });
      }
    }

    this.clearProcessed(userId);

    const response = {
      processed: results.length,
      results,
      requiresResign,
    };
    if (sequenceDrift) response.sequenceDrift = sequenceDrift;
    return response;
  }
}

export { OfflineQueue };
export default new OfflineQueue();
