import { getWebhook, getWebhooksForAccount, signPayload } from './store.js';
import { validateWebhookUrl } from './urlValidator.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // ms, indexed by attempt number (0-based)

async function deliverOnce(webhook, payload) {
  // Re-check the URL at delivery time in case the resolved address changed
  // since registration (DNS rebinding into a private/internal range).
  const validation = await validateWebhookUrl(webhook.url);
  if (!validation.valid) {
    throw new Error(`Webhook URL failed validation: ${validation.error}`);
  }

  const signature = signPayload(webhook.signingSecret, payload);

  const res = await fetch(webhook.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-FuTuRe-Signature': `sha256=${signature}`,
      'X-Webhook-Id': webhook.id,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/**
 * Attempt delivery for a single WebhookDelivery row and persist the outcome.
 * On success the row is marked DELIVERED. On failure it is either rescheduled
 * (status stays PENDING with a bumped nextAttemptAt) or marked FAILED once
 * maxAttempts is exhausted — the dead-letter state callers can query.
 */
async function attemptDelivery(delivery) {
  const webhook = getWebhook(delivery.webhookId);
  if (!webhook || webhook.accountId !== delivery.accountId) {
    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'FAILED', lastError: 'Webhook no longer registered' },
    });
  }

  const payload = {
    webhookId: webhook.id,
    event: { type: delivery.eventType, accountId: delivery.accountId, data: delivery.payload },
    timestamp: Date.now(),
  };

  try {
    await deliverOnce(webhook, payload);
    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'DELIVERED',
        attempt: delivery.attempt + 1,
        deliveredAt: new Date(),
        lastError: null,
      },
    });
  } catch (err) {
    const attempt = delivery.attempt + 1;
    if (attempt < delivery.maxAttempts) {
      const delay = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
      return prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { attempt, lastError: err.message, nextAttemptAt: new Date(Date.now() + delay) },
      });
    }

    logger.error(
      { webhookId: webhook.id, error: err.message },
      `Webhook delivery failed after ${attempt} attempts`,
    );
    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'FAILED', attempt, lastError: err.message },
    });
  }
}

/**
 * Dispatch an event to every webhook registered for the account. Creates a
 * durable WebhookDelivery row per matching webhook (so the attempt survives a
 * restart) and makes the first delivery attempt immediately.
 */
export async function dispatchEvent(accountId, eventType, data) {
  try {
    const hooks = getWebhooksForAccount(accountId).filter(
      (w) => w.events.includes('*') || w.events.includes(eventType),
    );
    if (!hooks.length) return [];

    const deliveries = await Promise.all(
      hooks.map((w) =>
        prisma.webhookDelivery.create({
          data: {
            webhookId: w.id,
            accountId,
            eventType,
            payload: data,
            maxAttempts: MAX_RETRIES,
          },
        }),
      ),
    );

    await Promise.all(
      deliveries.map((d) =>
        attemptDelivery(d).catch((err) => {
          logger.error(
            { webhookId: d.webhookId, error: err.message },
            'Webhook delivery attempt threw',
          );
        }),
      ),
    );

    return deliveries;
  } catch (err) {
    logger.error({ accountId, eventType, error: err.message }, 'dispatchEvent failed');
    return [];
  }
}

/**
 * Scheduler tick: find every delivery that is due for a retry and attempt it.
 * Replaces the previous in-process setTimeout chain so pending retries are
 * durable across restarts.
 */
export async function processDueWebhookDeliveries() {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    take: 100,
  });

  for (const delivery of due) {
    try {
      await attemptDelivery(delivery);
    } catch (err) {
      logger.error({ deliveryId: delivery.id, error: err.message }, 'Webhook delivery retry threw');
    }
  }

  return due.length;
}
