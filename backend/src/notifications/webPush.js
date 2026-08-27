/**
 * Web Push sender — RFC 8291 payload encryption + VAPID authentication via
 * the `web-push` package (issue #1123).
 *
 * Subscriptions are stored in memory keyed by userId AND publicKey. This is
 * fine for a single instance; a multi-instance deployment should move this
 * to the same shared store used elsewhere (see `mobile/redisStore.js`).
 *
 * VAPID credentials come from:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  - generate with `npx web-push generate-vapid-keys`
 *   VAPID_SUBJECT                        - a mailto: URI or https: URL identifying the sender
 */
import webpush from 'web-push';
import logger from '../config/logger.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@example.com';

let vapidConfigured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
  } catch (err) {
    logger.error('webpush.vapid.invalid', { error: err.message });
  }
} else {
  logger.warn('webpush.vapid.notConfigured', {
    message:
      'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not set — web push notifications will be skipped. ' +
      'Generate a pair with `npx web-push generate-vapid-keys`.',
  });
}

/** @returns {boolean} Whether VAPID credentials were loaded successfully. */
export function isVapidConfigured() {
  return vapidConfigured;
}

// userId -> { subscription, publicKey }
const byUserId = new Map();
// publicKey -> subscription
const byPublicKey = new Map();

export function saveSubscription(userId, subscription, publicKey) {
  byUserId.set(userId, { subscription, publicKey });
  if (publicKey) byPublicKey.set(publicKey, subscription);
}

export function getSubscription(userId) {
  return byUserId.get(userId)?.subscription ?? null;
}

export function getSubscriptionByPublicKey(publicKey) {
  return byPublicKey.get(publicKey) ?? null;
}

/**
 * Remove a subscription from all indexes. Called automatically when the push
 * service reports the endpoint is gone (HTTP 404/410) so we stop retrying a
 * dead subscription (issue #1123).
 * @param {{ endpoint: string }} subscription
 * @returns {number} Number of index entries removed
 */
export function removeSubscription(subscription) {
  if (!subscription?.endpoint) return 0;
  let removed = 0;
  for (const [userId, entry] of byUserId) {
    if (entry?.subscription?.endpoint === subscription.endpoint) {
      byUserId.delete(userId);
      removed++;
    }
  }
  for (const [publicKey, sub] of byPublicKey) {
    if (sub?.endpoint === subscription.endpoint) {
      byPublicKey.delete(publicKey);
      removed++;
    }
  }
  return removed;
}

/**
 * Send an RFC 8291-encrypted, VAPID-authenticated Web Push notification.
 * @param {object} subscription - PushSubscription `{ endpoint, keys: { p256dh, auth } }`
 * @param {object} payload - `{ title, body, data? }` — JSON-encoded and encrypted for the client
 * @param {object} [options]
 * @param {{ subject: string, publicKey: string, privateKey: string }} [options.vapidDetails] -
 *   Override the default VAPID credentials (primarily for tests / multi-tenant senders).
 * @param {object} [options.webPushOptions] - Extra options passed through to `webpush.sendNotification` (e.g. `TTL`, `urgency`)
 * @returns {Promise<{ sent: boolean, status?: number, reason?: string, error?: string }>}
 */
export async function sendWebPush(subscription, payload, options = {}) {
  if (!subscription?.endpoint) return { sent: false, reason: 'no_subscription' };

  const vapidDetails = options.vapidDetails ?? (vapidConfigured
    ? { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY }
    : null);

  if (!vapidDetails) {
    logger.warn('webpush.skipped.vapidNotConfigured', { endpoint: subscription.endpoint });
    return { sent: false, reason: 'vapid_not_configured' };
  }

  try {
    const result = await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails,
      TTL: 86400,
      ...options.webPushOptions,
    });
    logger.info('webpush.sent', { status: result.statusCode, endpoint: subscription.endpoint });
    return { sent: true, status: result.statusCode };
  } catch (err) {
    const status = err.statusCode;

    // 404 (Not Found) / 410 (Gone) mean the push service has permanently
    // invalidated this subscription (browser uninstalled, permission
    // revoked, endpoint rotated past its lifetime, etc.) — retrying is
    // pointless, so prune it from storage (issue #1123).
    if (status === 404 || status === 410) {
      const removed = removeSubscription(subscription);
      logger.info('webpush.subscription.expired', {
        endpoint: subscription.endpoint,
        status,
        removedEntries: removed,
      });
      return { sent: false, reason: 'subscription_expired', status };
    }

    logger.error('webpush.failed', { error: err.message, status, endpoint: subscription.endpoint });
    return { sent: false, error: err.message, status };
  }
}
