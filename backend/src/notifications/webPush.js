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
 * Web Push — stores push subscriptions in Redis, keyed by
 *   webpush:user:{userId}   — full { subscription, publicKey } object
 *   webpush:key:{publicKey} — raw subscription object
 *
 * Replaces the old in-process Map approach (byUserId, byPublicKey) that was
 * invisible to other process instances.  Subscriptions are stored without a
 * TTL so they persist until explicitly removed.
 *
 * Migrated as part of Issue #1125.
 */
import https from 'https';
import { URL } from 'url';
import { RedisBackend } from '../cache/redis.js';
import logger from '../config/logger.js';

const redis = new RedisBackend();

// ── Key helpers ───────────────────────────────────────────────────────────────

function userKey(userId) {
  return `webpush:user:${userId}`;
}

function publicKeyKey(publicKey) {
  return `webpush:key:${publicKey}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Persist a push subscription for a user.
 * @param {string} userId
 * @param {object} subscription  — PushSubscription { endpoint, keys? }
 * @param {string} [publicKey]   — VAPID / device public key used as secondary index
 */
export async function saveSubscription(userId, subscription, publicKey) {
  await redis.set(userKey(userId), { subscription, publicKey });
  if (publicKey) {
    await redis.set(publicKeyKey(publicKey), subscription);
  }
}

/**
 * Remove a subscription from all indexes. Called automatically when the push
 * service reports the endpoint is gone (HTTP 404/410) so we stop retrying a
 * dead subscription (issue #1123).
 * @param {{ endpoint: string }} subscription
 * @returns {number} Number of index entries removed
 * Look up the push subscription for a user.
 * @param {string} userId
 * @returns {Promise<object|null>} PushSubscription or null
 */
export async function getSubscription(userId) {
  const record = await redis.get(userKey(userId));
  return record?.subscription ?? null;
}

/**
 * Look up a subscription by its VAPID / device public key.
 * @param {string} publicKey
 * @returns {Promise<object|null>} PushSubscription or null
 */
export async function getSubscriptionByPublicKey(publicKey) {
  return redis.get(publicKeyKey(publicKey));
}

/**
 * Remove a user's push subscription from both indexes.
 * @param {string} userId
 */
export async function removeSubscription(userId) {
  const record = await redis.get(userKey(userId));
  if (record?.publicKey) {
    await redis.delete(publicKeyKey(record.publicKey));
  }
  await redis.delete(userKey(userId));
}

// ── Delivery ──────────────────────────────────────────────────────────────────

/**
 * Send a Web Push notification.
 * @param {object} subscription — PushSubscription { endpoint, keys? }
 * @param {object} payload      — { title, body, data? }
 * @returns {Promise<{ sent: boolean, status?: number, reason?: string, error?: string }>}
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
