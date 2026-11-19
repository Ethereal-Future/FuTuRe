/**
 * Push notification channel.
 * Delegates to the existing mobile PushNotifications service.
 * In production, swap _send() in mobile/notifications.js to call FCM/APNs.
 */
import pushNotifications from '../../mobile/notifications.js';
import logger from '../../config/logger.js';

// Transient push gateway errors are retried with exponential backoff.
const TRANSIENT_ERRORS = new Set([
  'Unavailable',
  'InternalServerError',
  'DeviceMessageRateExceeded',
]);

// Permanent errors mean the device token is stale and must be pruned.
const PERMANENT_ERRORS = new Set([
  'BadDeviceToken',
  'Unregistered',
  'InvalidRegistration',
]);

// Backoff schedule (ms) for transient retries: 1s, 5s, 15s.
const RETRY_BACKOFF_MS = [1000, 5000, 15000];

/**
 * Classify a push gateway error.
 * @param {Error & { code?: string, statusCode?: number }} err
 * @returns {'transient' | 'permanent' | 'unknown'}
 */
export function classifyPushError(err) {
  const code = err?.code || err?.errorCode || err?.name;
  if (code && TRANSIENT_ERRORS.has(code)) return 'transient';
  if (code && PERMANENT_ERRORS.has(code)) return 'permanent';
  // APNS returns HTTP 503 for gateway unavailability; 410 for unregistered tokens.
  if (err?.statusCode === 503) return 'transient';
  if (err?.statusCode === 410) return 'permanent';
  return 'unknown';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a push notification to all registered devices for a user.
 * Transient gateway failures are retried with exponential backoff;
 * permanent token errors are surfaced so the caller can prune the token.
 * @param {string} userId
 * @param {{ title: string, body: string, data?: object }} content
 * @returns {Promise<{ success: boolean, sent: number, error?: string, invalidTokens?: string[] }>}
 */
export async function sendPush(userId, { title, body, data = {} }) {
  let lastError;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      const result = await pushNotifications.notify(userId, { title, body, data });
      logger.info('push.sent', { userId, title, sent: result.sent });
      return { success: true, sent: result.sent };
    } catch (err) {
      lastError = err;
      const kind = classifyPushError(err);
      if (kind === 'permanent') {
        logger.error('push.send.invalid_token', { userId, title, error: err.message });
        return {
          success: false,
          sent: 0,
          error: err.message,
          invalidTokens: err.invalidTokens || [],
        };
      }
      if (kind === 'transient' && attempt < RETRY_BACKOFF_MS.length) {
        const delay = RETRY_BACKOFF_MS[attempt];
        logger.warn('push.send.retry', { userId, title, attempt: attempt + 1, delay, error: err.message });
        await sleep(delay);
        continue;
      }
      logger.error('push.send.failed', { userId, title, error: err.message });
      return { success: false, sent: 0, error: err.message };
    }
  }
  logger.error('push.send.failed', { userId, title, error: lastError?.message });
  return { success: false, sent: 0, error: lastError?.message };
}
