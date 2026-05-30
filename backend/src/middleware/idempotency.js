import crypto from 'crypto';
import { createRedisBackend } from '../cache/redis.js';

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours in seconds
const redisBackend = createRedisBackend(process.env.REDIS_URL);

/**
 * Middleware to enforce idempotency on payment endpoints.
 * Stores request body + response for 24 hours using the Idempotency-Key header.
 * Returns cached response for duplicate requests with same key.
 * Returns 422 if same key used with different request body.
 */
export const idempotencyMiddleware = async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];

  // If no key provided, skip idempotency check
  if (!idempotencyKey) {
    return next();
  }

  // Validate key format (UUID or similar)
  if (!/^[a-zA-Z0-9\-]{1,255}$/.test(idempotencyKey)) {
    return res.status(400).json({ error: 'Invalid Idempotency-Key format' });
  }

  const cacheKey = `idempotency:${idempotencyKey}`;
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body)).digest('hex');

  try {
    const cached = await redisBackend.get(cacheKey);

    if (cached) {
      // Check if request body matches
      if (cached.bodyHash !== bodyHash) {
        return res.status(422).json({
          error: 'Idempotency-Key used with different request body',
        });
      }

      // Return cached response
      return res.status(cached.statusCode).json(cached.response);
    }

    // Intercept response to cache it
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      const statusCode = res.statusCode;

      // Only cache successful responses (2xx)
      if (statusCode >= 200 && statusCode < 300) {
        redisBackend.set(cacheKey, {
          bodyHash,
          statusCode,
          response: data,
        }, IDEMPOTENCY_TTL).catch(() => {});
      }

      return originalJson(data);
    };

    next();
  } catch (error) {
    // If cache fails, continue without idempotency
    next();
  }
};
