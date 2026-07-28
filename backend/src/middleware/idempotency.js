import crypto from 'crypto';
import { createRedisBackend } from '../cache/redis.js';
import logger from '../config/logger.js';
import { incrementCounter } from '../monitoring/metrics.js';

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours in seconds
const IN_PROGRESS_TTL = 30; // seconds a claim is held while the handler runs
const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 5000;

const redisBackend = createRedisBackend(process.env.REDIS_URL);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll the cache key while a concurrent request holds the claim, until it
 * either resolves to a final response, turns out to be for a different
 * request body, or the poll window times out.
 */
async function waitForResult(cacheKey, bodyHash) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const cached = await redisBackend.get(cacheKey);

    if (cached) {
      if (cached.bodyHash !== bodyHash) {
        return { mismatch: true };
      }
      if (cached.status !== 'in-progress') {
        return { response: cached };
      }
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return { timedOut: true };
}

/**
 * Middleware to enforce idempotency on payment endpoints.
 * Atomically claims the Idempotency-Key via Redis SETNX before the handler
 * runs, so concurrent duplicate requests can't both slip past the cache-miss
 * check. A request that loses the claim polls for the in-flight request's
 * result and returns it, or 409s if it's still processing.
 */
export const idempotencyMiddleware = async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];

  // If no key provided, skip idempotency check
  if (!idempotencyKey) {
    return next();
  }

  // Validate key format (UUID or similar)
  if (!/^[a-zA-Z0-9-]{1,255}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'Invalid Idempotency-Key format' });
  }

  const cacheKey = `idempotency:${idempotencyKey}`;
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');

  try {
    const claimed = await redisBackend.setNX(cacheKey, { bodyHash, status: 'in-progress' }, IN_PROGRESS_TTL);

    if (!claimed) {
      const outcome = await waitForResult(cacheKey, bodyHash);

      if (outcome.mismatch) {
        return res.status(422).json({ error: 'Idempotency-Key used with different request body' });
      }
      if (outcome.timedOut) {
        return res.status(409).json({ error: 'A request with this Idempotency-Key is still being processed' });
      }
      return res.status(outcome.response.statusCode).json(outcome.response.response);
    }

    // Intercept response to cache it
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      const statusCode = res.statusCode;

      if (statusCode >= 200 && statusCode < 300) {
        // Only cache successful responses (2xx)
        redisBackend
          .set(cacheKey, { bodyHash, statusCode, response: data }, IDEMPOTENCY_TTL)
          .catch((error) => {
            logger.warn({ err: error?.message, idempotencyKey }, 'Failed to persist idempotent response to cache');
          });
      } else {
        // Release the claim so a retry after a failed attempt isn't stuck behind it
        redisBackend.delete(cacheKey).catch((error) => {
          logger.warn({ err: error?.message, idempotencyKey }, 'Failed to release idempotency claim after error response');
        });
      }

      return originalJson(data);
    };

    next();
  } catch (error) {
    incrementCounter('idempotency_bypass_total');
    logger.warn({ err: error?.message, idempotencyKey }, 'Idempotency check failed; bypassing protection');
    next();
  }
};
