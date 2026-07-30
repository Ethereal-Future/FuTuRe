import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

/**
 * Maximum number of webhooks a single account may register at once.
 * Enforced at registration time to prevent unbounded row growth.
 */
export const MAX_WEBHOOKS_PER_ACCOUNT = 20;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Register a new webhook for an account.
 *
 * @param {{ url: string, accountId: string, events?: string[], secret?: string }} opts
 * @returns {Promise<{ id: string, url: string, accountId: string, events: string[], signingSecret: string }>}
 * @throws {Error} 'Webhook limit reached' when the account already has MAX_WEBHOOKS_PER_ACCOUNT active webhooks
 */
export async function registerWebhook({ url, accountId, events, secret }) {
  // Enforce per-account cap before inserting.
  const count = await prisma.webhook.count({
    where: { accountId, deletedAt: null },
  });
  if (count >= MAX_WEBHOOKS_PER_ACCOUNT) {
    throw new Error(
      `Webhook limit reached. An account may not exceed ${MAX_WEBHOOKS_PER_ACCOUNT} webhooks.`,
    );
  }

  const signingSecret = secret ?? randomBytes(32).toString('hex');
  const resolvedEvents = events ?? ['*'];

  const webhook = await prisma.webhook.create({
    data: {
      accountId,
      url,
      events: resolvedEvents,
      signingSecret,
      previousSecrets: [],
    },
  });

  return {
    id: webhook.id,
    url: webhook.url,
    accountId: webhook.accountId,
    events: webhook.events,
    signingSecret: webhook.signingSecret,
  };
}

/**
 * List all active webhooks for an account, omitting secrets.
 *
 * @param {string} accountId
 * @returns {Promise<Array<{ id: string, url: string, accountId: string, events: string[], createdAt: Date, lastRotatedAt: Date }>>}
 */
export async function listWebhooks(accountId) {
  const rows = await prisma.webhook.findMany({
    where: { accountId, deletedAt: null },
    select: {
      id: true,
      url: true,
      accountId: true,
      events: true,
      createdAt: true,
      lastRotatedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows;
}

/**
 * Fetch a single webhook by ID (including secrets, for internal use).
 * Returns null when the webhook does not exist or has been soft-deleted.
 *
 * @param {string} id
 * @returns {Promise<import('@prisma/client').Webhook | null>}
 */
export async function getWebhook(id) {
  return prisma.webhook.findFirst({ where: { id, deletedAt: null } });
}

/**
 * Soft-delete a webhook by ID.
 *
 * @param {string} id
 * @returns {Promise<boolean>} true when a row was actually deleted, false when not found
 */
export async function deleteWebhook(id) {
  const result = await prisma.webhook.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Fetch all active webhooks for an account (used by the dispatcher).
 *
 * @param {string} accountId
 * @returns {Promise<import('@prisma/client').Webhook[]>}
 */
export async function getWebhooksForAccount(accountId) {
  return prisma.webhook.findMany({
    where: { accountId, deletedAt: null },
  });
}

// ---------------------------------------------------------------------------
// Signing helpers
// ---------------------------------------------------------------------------

/**
 * Sign payload with HMAC-SHA256.
 *
 * @param {string} secret
 * @param {object} payload
 * @returns {string} hex-encoded signature
 */
export function signPayload(secret, payload) {
  return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

/**
 * Verify a webhook signature, checking the current secret and any previous
 * secrets still within the rotation grace period.
 *
 * @param {string} webhookId
 * @param {string} signature   hex string
 * @param {object} payload
 * @returns {Promise<boolean>}
 */
export async function verifyWebhookSignature(webhookId, signature, payload) {
  const webhook = await getWebhook(webhookId);
  if (!webhook) return false;

  const safeEqual = (a, b) => {
    try {
      return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
      return false;
    }
  };

  // Check current secret.
  if (safeEqual(signature, signPayload(webhook.signingSecret, payload))) return true;

  // Check previous secrets (rotation grace period — up to 2 kept).
  for (const oldSecret of webhook.previousSecrets) {
    if (safeEqual(signature, signPayload(oldSecret, payload))) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Secret rotation
// ---------------------------------------------------------------------------

/**
 * Rotate a webhook's signing secret.  The old secret is pushed onto
 * previousSecrets (capped at 2) so in-flight requests signed with the prior
 * key still verify during the grace period.
 *
 * @param {string} webhookId
 * @returns {Promise<{ signingSecret: string }>}
 * @throws {Error} 'Webhook not found' when the webhook does not exist
 */
export async function rotateWebhookSecret(webhookId) {
  const webhook = await getWebhook(webhookId);
  if (!webhook) throw new Error('Webhook not found');

  // Prepend current secret; keep at most 2 previous secrets.
  const previousSecrets = [webhook.signingSecret, ...webhook.previousSecrets].slice(0, 2);
  const newSecret = randomBytes(32).toString('hex');

  await prisma.webhook.update({
    where: { id: webhookId },
    data: {
      signingSecret: newSecret,
      previousSecrets,
      lastRotatedAt: new Date(),
    },
  });

  logger.info({ webhookId }, 'Webhook secret rotated');

  return { signingSecret: newSecret };
}
