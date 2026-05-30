import { createHmac, randomBytes } from 'crypto';
import logger from '../config/logger.js';

// In-memory webhook store (replace with DB in production)
const webhooks = new Map();

export function registerWebhook({ url, accountId, events, secret }) {
  const id = randomBytes(8).toString('hex');
  const signingSecret = secret ?? randomBytes(32).toString('hex');
  const webhook = {
    id,
    url,
    accountId,
    events: events ?? ['*'],
    signingSecret,
    previousSecrets: [],
    createdAt: Date.now(),
    lastRotatedAt: Date.now(),
  };
  webhooks.set(id, webhook);
  return { id, url, accountId, events: webhook.events, signingSecret };
}

export function listWebhooks(accountId) {
  return [...webhooks.values()]
    .filter(w => !accountId || w.accountId === accountId)
    .map(({ signingSecret: _, previousSecrets: __, ...w }) => w);
}

export function getWebhook(id) {
  return webhooks.get(id) ?? null;
}

export function deleteWebhook(id) {
  return webhooks.delete(id);
}

export function getWebhooksForAccount(accountId) {
  return [...webhooks.values()].filter(w => w.accountId === accountId);
}

/**
 * Sign payload with HMAC-SHA256
 * @param {string} secret - The signing secret
 * @param {object} payload - The payload to sign
 * @returns {string} - The hex-encoded signature
 */
export function signPayload(secret, payload) {
  return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

/**
 * Verify webhook signature
 * @param {string} webhookId - The webhook ID
 * @param {string} signature - The signature from X-FuTuRe-Signature header
 * @param {object} payload - The payload that was signed
 * @returns {boolean} - Whether the signature is valid
 */
export function verifyWebhookSignature(webhookId, signature, payload) {
  const webhook = getWebhook(webhookId);
  if (!webhook) return false;

  // Try current secret
  const expectedSignature = signPayload(webhook.signingSecret, payload);
  if (signature === expectedSignature) return true;

  // Try previous secrets (for rotation grace period)
  for (const oldSecret of webhook.previousSecrets) {
    const oldSignature = signPayload(oldSecret, payload);
    if (signature === oldSignature) return true;
  }

  return false;
}

/**
 * Rotate webhook secret
 * @param {string} webhookId - The webhook ID
 * @returns {object} - The new signing secret
 */
export function rotateWebhookSecret(webhookId) {
  const webhook = getWebhook(webhookId);
  if (!webhook) throw new Error('Webhook not found');

  // Keep up to 2 previous secrets for rotation grace period
  webhook.previousSecrets.unshift(webhook.signingSecret);
  if (webhook.previousSecrets.length > 2) {
    webhook.previousSecrets.pop();
  }

  webhook.signingSecret = randomBytes(32).toString('hex');
  webhook.lastRotatedAt = Date.now();

  logger.info({ webhookId }, 'Webhook secret rotated');

  return { signingSecret: webhook.signingSecret };
}
