/**
 * Notification delivery tracking.
 * Records every delivery attempt and its outcome.
 */
import { randomUUID } from 'crypto';
import logger from '../config/logger.js';

// In-memory delivery log (replace with DB persistence for production)
const deliveryLog = [];
const MAX_LOG_SIZE = 10_000;

// Push gateway error classification.
// Transient errors are retried with exponential backoff; permanent errors
// indicate the device token is no longer valid and must be pruned.
const TRANSIENT_PUSH_ERRORS = new Set([
  'Unavailable',
  'InternalServerError',
  'DeviceMessageRateExceeded',
]);

const PERMANENT_PUSH_ERRORS = new Set([
  'BadDeviceToken',
  'Unregistered',
  'InvalidRegistration',
]);

// Exponential backoff schedule (ms): 1s, 5s, 15s
const PUSH_RETRY_DELAYS_MS = [1_000, 5_000, 15_000];

// Push dispatch metrics (Prometheus-compatible counters)
const pushMetrics = {
  push_delivered_total: 0,
  push_failed_total: 0,
  tokens_invalidated_total: 0,
};

/**
 * @typedef {object} DeliveryRecord
 * @property {string} id
 * @property {string} userId
 * @property {string} type
 * @property {string} channel
 * @property {'pending'|'sent'|'failed'|'skipped'} status
 * @property {string} [error]
 * @property {string} createdAt
 * @property {string} [updatedAt]
 */

/**
 * Classify a push gateway error code.
 * @param {string} [code]
 * @returns {'transient'|'permanent'|'unknown'}
 */
export function classifyPushError(code) {
  if (TRANSIENT_PUSH_ERRORS.has(code)) return 'transient';
  if (PERMANENT_PUSH_ERRORS.has(code)) return 'permanent';
  return 'unknown';
}

/**
 * Read current push dispatch metrics.
 * @returns {{ push_delivered_total: number, push_failed_total: number, tokens_invalidated_total: number }}
 */
export function getPushMetrics() {
  return { ...pushMetrics };
}

/**
 * Record a delivery attempt.
 * @param {object} params
 * @returns {DeliveryRecord}
 */
export function recordDelivery({ userId, type, channel, status, error }) {
  const record = {
    id: randomUUID(),
    userId,
    type,
    channel,
    status,
    error: error ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  deliveryLog.unshift(record);
  if (deliveryLog.length > MAX_LOG_SIZE) deliveryLog.splice(MAX_LOG_SIZE);

  if (status === 'failed') {
    logger.warn('notification.delivery.failed', { userId, type, channel, error });
  } else {
    logger.debug('notification.delivery.recorded', { userId, type, channel, status });
  }

  return record;
}

/**
 * Dispatch a push notification with retry/backoff and token invalidation.
 *
 * Transient gateway errors are retried up to 3 times with exponential
 * backoff (1s, 5s, 15s). Permanent errors (BadDeviceToken / Unregistered /
 * InvalidRegistration) immediately prune the stale device token.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.type
 * @param {string} params.token - device token
 * @param {(token: string) => Promise<object>} params.send - push gateway sender
 * @param {{ userDevice?: { delete: (args: object) => Promise<object> } }} [params.prisma]
 * @param {(ms: number) => Promise<void>} [params.sleep]
 * @returns {Promise<{ status: 'sent'|'failed', attempts: number, error?: string }>}
 */
export async function dispatchPush({
  userId,
  type,
  token,
  send,
  prisma,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) {
  let attempts = 0;

  for (let i = 0; i <= PUSH_RETRY_DELAYS_MS.length; i++) {
    attempts++;
    try {
      await send(token);
      pushMetrics.push_delivered_total++;
      recordDelivery({ userId, type, channel: 'push', status: 'sent' });
      return { status: 'sent', attempts };
    } catch (err) {
      const code = err?.code ?? err?.error?.status ?? err?.message;
      const kind = classifyPushError(code);

      if (kind === 'permanent') {
        pushMetrics.push_failed_total++;
        pushMetrics.tokens_invalidated_total++;
        logger.warn('notification.push.token_invalidated', { userId, type, code });
        if (prisma?.userDevice?.delete) {
          try {
            await prisma.userDevice.delete({ where: { token } });
          } catch (deleteErr) {
            logger.error('notification.push.token_delete_failed', {
              userId,
              type,
              error: deleteErr?.message,
            });
          }
        }
        recordDelivery({ userId, type, channel: 'push', status: 'failed', error: code });
        return { status: 'failed', attempts, error: code };
      }

      if (kind === 'transient' && i < PUSH_RETRY_DELAYS_MS.length) {
        const delay = PUSH_RETRY_DELAYS_MS[i];
        logger.warn('notification.push.retry', { userId, type, code, attempt: attempts, delay });
        await sleep(delay);
        continue;
      }

      pushMetrics.push_failed_total++;
      recordDelivery({ userId, type, channel: 'push', status: 'failed', error: code });
      return { status: 'failed', attempts, error: code };
    }
  }

  pushMetrics.push_failed_total++;
  recordDelivery({ userId, type, channel: 'push', status: 'failed', error: 'retries_exhausted' });
  return { status: 'failed', attempts, error: 'retries_exhausted' };
}

/**
 * Get delivery records for a user.
 * @param {string} userId
 * @param {{ type?: string, channel?: string, status?: string, limit?: number }} filters
 * @returns {DeliveryRecord[]}
 */
export function getDeliveryHistory(userId, { type, channel, status, limit = 50 } = {}) {
  return deliveryLog
    .filter(r =>
      r.userId === userId &&
      (!type    || r.type    === type)    &&
      (!channel || r.channel === channel) &&
      (!status  || r.status  === status)
    )
    .slice(0, limit);
}

/**
 * Get aggregate delivery stats for a user.
 * @param {string} userId
 * @returns {object}
 */
export function getDeliveryStats(userId) {
  const records = deliveryLog.filter(r => r.userId === userId);
  const stats = { total: records.length, byChannel: {}, byStatus: {} };

  for (const r of records) {
    stats.byChannel[r.channel] = (stats.byChannel[r.channel] ?? 0) + 1;
    stats.byStatus[r.status]   = (stats.byStatus[r.status]   ?? 0) + 1;
  }

  return stats;
}
