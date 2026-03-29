/**
 * Notification delivery tracking.
 * Records every delivery attempt and its outcome.
 */
import logger from '../config/logger.js';

// In-memory delivery log (replace with DB persistence for production)
const deliveryLog = [];
const MAX_LOG_SIZE = 10_000;

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
 * Record a delivery attempt.
 * @param {object} params
 * @returns {DeliveryRecord}
 */
export function recordDelivery({ userId, type, channel, status, error }) {
  const record = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
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
