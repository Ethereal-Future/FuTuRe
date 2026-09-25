import { getWebhook, getWebhooksForAccount, signPayload } from './store.js';
import { validateWebhookUrl } from './urlValidator.js';
import { decrypt } from '../db/encryption.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';
import { Agent } from 'undici';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // ms, indexed by attempt number (0-based)
const CLAIM_BATCH_SIZE = 50;

/**
 * Build an undici dispatcher that connects strictly to the pre-validated IP
 * address, preventing a second DNS resolution (DNS rebinding / TOCTOU SSRF).
 * The original hostname is preserved for TLS SNI (servername) and the HTTP
 * Host header so certificate validation and virtual hosting still work.
 */
function createPinnedDispatcher(hostname, pinnedIp) {
  return new Agent({
    connect: {
      // Pin the TCP connection to the exact IP that passed validation.
      lookup: (_host, _opts, cb) => cb(null, pinnedIp, pinnedIp.includes(':') ? 6 : 4),
      // Preserve the original hostname for TLS SNI / certificate validation.
      servername: hostname,
    },
  });
}

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

/**
 * Resolve the plaintext signing secret for a webhook. Secrets are encrypted at
 * rest (AES-256-GCM) and are only decrypted in-memory here, immediately before
 * the HMAC is computed, so a database read leak never exposes usable keys.
 */
function resolveSigningSecret(webhook) {
  const key = process.env.WEBHOOK_SECRET_KEY;
  if (!key) {
    throw new Error('WEBHOOK_SECRET_KEY is not configured');
  }
  return decrypt(webhook.signingSecret, key);
}

async function deliverOnce(webhook, payload) {
  // Re-check the URL at delivery time and capture the exact resolved IP so the
  // subsequent fetch cannot be redirected to a private address via DNS
  // rebinding (TOCTOU).
  const validation = await validateWebhookUrl(webhook.url);
  if (!validation.valid) {
    throw new Error(`Webhook URL failed validation: ${validation.error}`);
  }

  const signature = signPayload(resolveSigningSecret(webhook), payload);
  const target = new URL(webhook.url);
  const pinnedIp = validation.ip;
  if (!pinnedIp) {
    throw new Error('Webhook URL validation did not return a resolved IP address');
  }

  const signature = signPayload(webhook.signingSecret, payload);
  const dispatcher = createPinnedDispatcher(target.hostname, pinnedIp);

  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-FuTuRe-Signature': `sha256=${signature}`,
        'X-Webhook-Id': webhook.id,
        // Preserve the original hostname for virtual hosting.
        Host: target.host,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
      dispatcher,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    await dispatcher.close();
  }
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
        data: {
          status: 'PENDING',
          attempt,
          lastError: err.message,
          nextAttemptAt: new Date(Date.now() + delay),
        },
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

    await 
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
 * Atomically claim a disjoint batch of due deliveries for this instance.
 *
 * Uses PostgreSQL's `FOR UPDATE SKIP LOCKED` queue pattern so that concurrent
 * backend instances each claim a non-overlapping set of rows: rows already
 * locked by another instance are skipped rather than blocked on, and the
 * UPDATE ... RETURNING transitions the claimed rows to PROCESSING in the same
 * statement so no other instance can pick them up. This guarantees each
 * delivery row is processed by exactly one instance.
 */
async function claimDueDeliveries(limit = CLAIM_BATCH_SIZE) {
  return prisma.$queryRaw`
    UPDATE webhook_deliveries
    SET status = 'PROCESSING', updated_at = NOW()
    WHERE id IN (
      SELECT id FROM webhook_deliveries
      WHERE status = 'PENDING' AND next_attempt_at <= NOW()
      ORDER BY next_attempt_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `;
}

/**
 * Scheduler tick: atomically claim every delivery that is due for a retry and
 * attempt it. Replaces the previous in-process setTimeout chain so pending
 * retries are durable across restarts, and uses SELECT ... FOR UPDATE SKIP
 * LOCKED so multiple instances never dispatch the same delivery twice.
 */
export async function processDueWebhookDeliveries() {
  const claimed = await claimDueDeliveries();

  for (const delivery of claimed) {
    try {
      await attemptDelivery(delivery);
    } catch (err) {
      logger.error({ deliveryId: delivery.id, error: err.message }, 'Webhook delivery retry threw');
      // Release the claim so the row can be retried on a later tick instead of
      // being stranded in PROCESSING.
      await prisma.webhookDelivery
        .update({
          where: { id: delivery.id },
          data: { status: 'PENDING', lastError: err.message },
        })
        .catch((releaseErr) =>
          logger.error(
            { deliveryId: delivery.id, error: releaseErr.message },
            'Failed to release webhook delivery claim',
          ),
        );
    }
  }

  return claimed.length;
}
