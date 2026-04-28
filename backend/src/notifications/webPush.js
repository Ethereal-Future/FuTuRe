/**
 * Minimal Web Push sender.
 * Stores subscriptions in memory keyed by userId AND publicKey.
 * For production, replace with the `web-push` npm package and configure
 * VAPID keys via VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars.
 */
import https from 'https';
import { URL } from 'url';
import logger from '../config/logger.js';

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
 * Send a Web Push notification.
 * @param {object} subscription - PushSubscription { endpoint, keys? }
 * @param {object} payload - { title, body, data? }
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
