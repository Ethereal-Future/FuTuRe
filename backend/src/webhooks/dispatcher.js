import { getWebhook, getWebhooksForAccount, signPayload } from './store.js';
import { validateWebhookUrl } from './urlValidator.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // ms, indexed by attempt number (0-based)

// Circuit breaker: after this many consecutive delivery failures an endpoint is
// considered dead and is automatically disabled so we stop queuing doomed rows.
const CONSECUTIVE_FAILURE_THRESHOLD = 20;

// Bounded concurrency for the scheduler tick. Without this, a batch of dead
// subscriber endpoints would each block the loop for the full 5s timeout,
// starving healthy deliveries and monopolizing the worker process.
const MAX_CONCURRENT_DELIVERIES = 10;
// Per-host cap so a single subscriber is never flooded with the full global
// concurrency (e.g. 10 parallel connections to one downed server).
const MAX_CONCURRENT_PER_HOST = 3;

/**
 * Minimal in-repo concurrency pool. Returns a `limit` function that queues
 * tasks and runs at most `concurrency` of them at a time.
 */
function createLimiter(concurrency) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

/**
 * Derive a throttle key for a delivery so all deliveries targeting the same
 * subscriber host share a per-host limiter.
 */
function hostKeyFor(webhook) {
  try {
    return new URL(webhook.url).host;
  } catch {
    return webhook.url;
  }
}

/**
 * Notify the account owner that their webhook endpoint was disabled after too
 * many consecutive delivery failures. Best-effort: a notification failure must
 * never mask the delivery outcome or crash the dispatcher.
 */
async function notifyWebhookDisabled(webhook, lastError) {
  try {
    const account = await prisma.account.findUnique({
      where: { id: webhook.accountId },
      select: { email: true },
    });
    if (!account?.email) return;

    await prisma.notification.create({
      data: {
        accountId: webhook.accountId,
        type: 'WEBHOOK_DISABLED',
        title: 'Webhook endpoint disabled due to continuous delivery errors',
        body:
          `Your webhook endpoint ${webhook.url} was disabled after ` +
          `${CONSECUTIVE_FAILURE_THRESHOLD} consecutive delivery failures. ` +
          `Last error: ${lastError}. Fix your server and re-enable the endpoint ` +
          `to resume deliveries.`,
      },
    });
  } catch (err) {
    logger.error(
      { webhookId: webhook.id, error: err.message },
      'Failed to send webhook-disabled notification',
    );
  }
}

/**
 * Circuit breaker bookkeeping for a failed delivery. Increments the webhook's
 * consecutive failure counter and, once the threshold is reached, transitions
 * the endpoint from ACTIVE to DISABLED and alerts the account owner.
 */
async function recordFailure(webhook, lastError) {
  try {
    const updated = await prisma.webhook.update({
      where: { id: webhook.id },
      data: { consecutiveFailures: { increment: 1 } },
    });

    if (
      updated.consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD &&
      updated.status === 'ACTIVE'
    ) {
      await prisma.webhook.update({
        where: { id: webhook.id },
        data: { status: 'DISABLED' },
      });
      logger.warn(
        { webhookId: webhook.id, consecutiveFailures: updated.consecutiveFailures },
        'Webhook endpoint auto-disabled after continuous delivery failures',
      );
      await notifyWebhookDisabled(webhook, lastError);
    }
  } catch (err) {
    logger.error(
      { webhookId: webhook.id, error: err.message },
      'Failed to record webhook delivery failure',
    );
  }
}

/**
 * Reset the circuit breaker after a successful delivery so a recovered endpoint
 * starts from a clean slate.
 */
async function recordSuccess(webhook) {
  if (!webhook.consecutiveFailures) return;
  try {
    await prisma.webhook.update({
      where: { id: webhook.id },
      data: { consecutiveFailures: 0 },
    });
  } catch (err) {
    logger.error(
      { webhookId: webhook.id, error: err.message },
      'Failed to reset webhook failure counter',
    );
  }
}

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
  const webhook = await getWebhook(delivery.webhookId);
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
    await recordSuccess(webhook);
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
    await recordFailure(webhook, err.message);
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
    const hooks = (await getWebhooksForAccount(accountId)).filter(
      (w) =>
        w.status !== 'DISABLED' && (w.events.includes('*') || w.events.includes(eventType)),
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
 *
 * Deliveries run with bounded parallelism (global + per-host) so slow or dead
 * subscriber endpoints no longer block healthy webhooks or the event loop.
 */
export async function processDueWebhookDeliveries() {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    take: 100,
  });

  if (!due.length) return 0;

  const globalLimit = createLimiter(MAX_CONCURRENT_DELIVERIES);
  const hostLimiters = new Map();
  const hostLimiterFor = (key) => {
    let limiter = hostLimiters.get(key);
    if (!limiter) {
      limiter = createLimiter(MAX_CONCURRENT_PER_HOST);
      hostLimiters.set(key, limiter);
    }
    return limiter;
  };

  await Promise.allSettled(
    due.map((delivery) =>
      globalLimit(async () => {
        const webhook = await getWebhook(delivery.webhookId);
        const hostKey = webhook ? hostKeyFor(webhook) : `delivery:${delivery.id}`;
        return hostLimiterFor(hostKey)(() => attemptDelivery(delivery));
      }).catch((err) => {
        logger.error(
          { deliveryId: delivery.id, error: err.message },
          'Webhook delivery retry threw',
        );
      }),
    ),
  );

  return due.length;
}
