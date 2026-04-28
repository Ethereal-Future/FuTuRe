import { createHmac, randomBytes } from 'crypto';

// In-memory webhook store (replace with DB in production)
const webhooks = new Map();

export function registerWebhook({ url, accountId, events, secret }) {
  const id = randomBytes(8).toString('hex');
  const signingSecret = secret ?? randomBytes(20).toString('hex');
  const webhook = { id, url, accountId, events: events ?? ['*'], signingSecret, createdAt: Date.now() };
  webhooks.set(id, webhook);
  return { id, url, accountId, events: webhook.events, signingSecret };
}

export function listWebhooks(accountId) {
  return [...webhooks.values()]
    .filter(w => !accountId || w.accountId === accountId)
    .map(({ signingSecret: _, ...w }) => w);
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

export function signPayload(secret, payload) {
  return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}
