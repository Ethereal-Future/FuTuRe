/**
 * Webhook Delivery Service — bounded-concurrency queue with dead-letter capture.
 *
 * Fixes ISSUE-312: Failed webhook retries trigger unbounded promise queue.
 *
 * Previously, each failed delivery spawned a free-floating `setTimeout`-based
 * promise that was never tracked, leading to unbounded memory growth when
 * endpoints were unresponsive. This module replaces that pattern with:
 *
 *  - A bounded in-memory queue (p-limit) so that at most
 *    MAX_CONCURRENT_DELIVERIES HTTP calls are in-flight at any time.
 *  - Durable delivery rows in the database so pending retries survive a
 *    process restart (no retry state lives only in memory).
 *  - A dead-letter state: once MAX_ATTEMPTS is exhausted the row is marked
 *    FAILED and the last error is recorded for operator inspection.
 */

import pLimit from 'p-limit';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

/** Maximum concurrent outbound HTTP delivery attempts across all webhooks. */
const MAX_CONCURRENT_DELIVERIES = Number(process.env.WEBHOOK_MAX_CONCURRENT ?? 10);

/** Concurrency limiter — the single bounded queue for this process. */
const limit = pLimit(MAX_CONCURRENT_DELIVERIES);

/** Maximum delivery attempts before a delivery row enters the dead-letter state. */
export const MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS ?? 4);

/**
 * Exponential back-off delay (ms) before the n-th retry (0-indexed attempt).
 * Caps at 60 seconds to prevent indefinite blocking.
 */
export function retryDelayMs(attempt) {
  const base = 1_000;
  const cap = 60_000;
  return Math.min(base * 2 ** attempt, cap);
}

/**
 * Attempt to deliver a single webhook payload to its endpoint.
 *
 * Wraps the actual HTTP call in the shared `p-limit` concurrency limiter so
 * that the total number of in-flight delivery promises is bounded regardless of
 * how many deliveries are queued.
 *
 * On success the delivery row is marked DELIVERED.
 * On failure:
 *   - If attempts remain, the row is rescheduled (nextAttemptAt updated).
 *   - If MAX_ATTEMPTS is exhausted, the row is moved to the FAILED dead-letter
 *     state; it will never be retried again and the last error is preserved.
 *
 * @param {object}   delivery            - WebhookDelivery Prisma record.
 * @param {Function} httpDeliverFn       - Async fn(delivery) → void; throws on HTTP error.
 * @returns {Promise<void>}
 */
export async function deliverWebhook(delivery, httpDeliverFn) {
  return limit(async () => {
    const attempt = delivery.attempt + 1;

    try {
      await httpDeliverFn(delivery);

      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'DELIVERED',
          attempt,
          deliveredAt: new Date(),
          lastError: null,
        },
      });

      logger.info(
        { webhookId: delivery.webhookId, deliveryId: delivery.id, attempt },
        'webhookDelivery.delivered',
      );
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) {
        // Dead-letter: max attempts exhausted — persist and stop retrying.
        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            attempt,
            lastError: err.message,
          },
        });

        logger.error(
          { webhookId: delivery.webhookId, deliveryId: delivery.id, attempt, error: err.message },
          'webhookDelivery.dead_lettered',
        );
      } else {
        const delay = retryDelayMs(attempt);

        await prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'PENDING',
            attempt,
            lastError: err.message,
            nextAttemptAt: new Date(Date.now() + delay),
          },
        });

        logger.warn(
          {
            webhookId: delivery.webhookId,
            deliveryId: delivery.id,
            attempt,
            nextAttemptMs: delay,
            error: err.message,
          },
          'webhookDelivery.scheduled_retry',
        );
      }
    }
  });
}

/**
 * Claim and dispatch all delivery rows that are due for a retry.
 *
 * Uses `SELECT … FOR UPDATE SKIP LOCKED` so concurrent instances each claim a
 * non-overlapping batch — no delivery is processed twice.
 *
 * All claimed rows are dispatched through the shared bounded limiter, so the
 * process-wide concurrency cap is respected even when the batch is large.
 *
 * @param {Function} httpDeliverFn  - Same async fn(delivery) used by deliverWebhook.
 * @param {number}   [batchSize=50] - Maximum rows to claim per tick.
 * @returns {Promise<number>} Number of deliveries dispatched in this tick.
 */
export async function processDueDeliveries(httpDeliverFn, batchSize = 50) {
  const claimed = await prisma.$queryRaw`
    UPDATE webhook_deliveries
    SET    status = 'PROCESSING', updated_at = NOW()
    WHERE  id IN (
      SELECT id
      FROM   webhook_deliveries
      WHERE  status = 'PENDING'
        AND  next_attempt_at <= NOW()
      ORDER  BY next_attempt_at ASC
      LIMIT  ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `;

  if (!claimed.length) return 0;

  await Promise.all(
    claimed.map((delivery) =>
      deliverWebhook(delivery, httpDeliverFn).catch((err) => {
        // deliverWebhook writes failure to DB; this catch prevents an unhandled
        // rejection from surfacing as an uncaughtException in the worker.
        logger.error(
          { deliveryId: delivery.id, error: err.message },
          'webhookDelivery.processDueDeliveries.unexpected_error',
        );
      }),
    ),
  );

  return claimed.length;
}
