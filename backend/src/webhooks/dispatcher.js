import { getWebhooksForAccount, signPayload } from './store.js';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // ms

async function deliverOnce(webhook, event) {
  const payload = { webhookId: webhook.id, event, timestamp: Date.now() };
  const signature = signPayload(webhook.signingSecret, payload);

  const res = await fetch(webhook.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Signature': `sha256=${signature}`,
      'X-Webhook-Id': webhook.id,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function deliverWithRetry(webhook, event, attempt = 0) {
  try {
    await deliverOnce(webhook, event);
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      setTimeout(() => deliverWithRetry(webhook, event, attempt + 1), RETRY_DELAYS[attempt]);
    } else {
      console.error(`Webhook ${webhook.id} failed after ${MAX_RETRIES} attempts: ${err.message}`);
    }
  }
}

export function dispatchEvent(accountId, eventType, data) {
  const hooks = getWebhooksForAccount(accountId).filter(
    w => w.events.includes('*') || w.events.includes(eventType)
  );
  const event = { type: eventType, accountId, data };
  hooks.forEach(w => deliverWithRetry(w, event));
}
