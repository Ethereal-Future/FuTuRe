/**
 * Express route-level cache middleware.
 *
 * Usage:
 *   router.get('/path', cacheMiddleware(ttlSeconds, keyFn), handler)
 *
 * keyFn(req) → string cache key. Defaults to req.originalUrl.
 * Adds X-Cache: HIT|MISS header.
 */

import { cacheGet, cacheSet } from '../cache/appCache.js';

export function cacheMiddleware(ttlSeconds, keyFn = (req) => req.originalUrl) {
  return async (req, res, next) => {
    const key = keyFn(req);
    const cached = await cacheGet(key);

    if (cached !== null) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    res.setHeader('X-Cache', 'MISS');

    // Intercept res.json to store the response in cache
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400) {
        cacheSet(key, body, ttlSeconds).catch(() => {});
      }
      return originalJson(body);
    };

    next();
  };
}
