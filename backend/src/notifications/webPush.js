/**
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
export async function sendWebPush(subscription, payload) {
  if (!subscription?.endpoint) return { sent: false, reason: 'no_subscription' };

  const body = JSON.stringify(payload);
  const endpoint = new URL(subscription.endpoint);

  return new Promise((resolve) => {
    const options = {
      hostname: endpoint.hostname,
      path: endpoint.pathname + endpoint.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        TTL: '86400',
      },
    };

    const req = https.request(options, (res) => {
      logger.info('webpush.sent', { status: res.statusCode });
      resolve({ sent: true, status: res.statusCode });
    });

    req.on('error', (err) => {
      logger.error('webpush.failed', { error: err.message });
      resolve({ sent: false, error: err.message });
    });

    req.write(body);
    req.end();
  });
}
