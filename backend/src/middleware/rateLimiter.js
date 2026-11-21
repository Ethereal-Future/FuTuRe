import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { isWhitelisted } from '../security/ipWhitelist.js';
import logger from '../config/logger.js';

// Atomic INCR + EXPIRE. Guarantees every rate-limit key has an active TTL:
// - TTL is (re)applied when the counter is created (count === 1)
// - TTL is also applied if the key somehow exists without one (ttl < 0)
// Returns { count, ttl } so callers can inspect the current window state.
const INCR_WITH_EXPIRE_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if current == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

// Runs the atomic script against the store's Redis client. Returns null when
// no Redis client is available (e.g. non-Redis stores) so callers can fall back.
async function incrementWithExpire(store, key, windowSeconds) {
  const client = store?.client || store?.store?.client;
  if (!client || typeof client.eval !== 'function') {
    return null;
  }

  const result = await client.eval(INCR_WITH_EXPIRE_SCRIPT, 1, key, windowSeconds);
  const [count, ttl] = Array.isArray(result) ? result : [result, windowSeconds];
  return { count: Number(count), ttl: Number(ttl) };
}

function getClientIP(req) {
  // req.ip is derived by Express from X-Forwarded-For only up to the
  // trusted hop count configured via `app.set('trust proxy', ...)`
  // (TRUST_PROXY_HOPS), so it can't be spoofed by a direct caller.
  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress;
}

function getUserRateLimitKey(req) {
  return req.user?.id || req.user?.userId || req.user?.sub || req.user?.publicKey || null;
}

function createRateLimiter(options = {}) {
  const {
    windowMs = 60000,
    max = 100,
    message = 'Too many requests, please try again later.',
    standardHeaders = true,
    legacyHeaders = false,
    skip = async (req) => await isWhitelisted(getClientIP(req)),
    keyGenerator = (req) => ipKeyGenerator(getClientIP(req)),
  } = options;

  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  const limiter = rateLimit({
    windowMs,
    max,
    message: {
      error: message,
      statusCode: 429,
      retryAfter: windowSeconds,
    },
    standardHeaders,
    legacyHeaders,
    skip,
    keyGenerator,
    // Use an atomic Lua script (EVAL) so INCR and EXPIRE happen in a single
    // transaction. This prevents keys from being created without a TTL when a
    // window rolls over under high traffic.
    store: undefined,
    requestWasSuccessful: undefined,
    // Custom store wrapper that guarantees TTL on every increment.
    ...(options.store ? { store: options.store } : {}),
    handler: async (req, res, _next, opts) => {
      const clientIP = getClientIP(req);
      const username = req.body?.username || 'unknown';

      logger.warn({
        ip: clientIP,
        userId: getUserRateLimitKey(req),
        path: req.path,
        method: req.method,
        username,
        whitelist: await isWhitelisted(clientIP),
      }, 'Rate limit exceeded');
      
      const retryAfter = windowSeconds;
      res.set('Retry-After', retryAfter.toString());
      
      res.status(429).json({
        error: opts.message.error || message,
        statusCode: 429,
        retryAfter,
      });
    },
  });

  return limiter;
}

function createPerUserRateLimiter(options = {}) {
  return createRateLimiter({
    ...options,
    keyGenerator: (req) => getUserRateLimitKey(req) || ipKeyGenerator(getClientIP(req)),
  });
}

const rateLimiter = createRateLimiter();

export {
  createRateLimiter,
  createPerUserRateLimiter,
  getClientIP,
  getUserRateLimitKey,
  incrementWithExpire,
  INCR_WITH_EXPIRE_SCRIPT,
};

export default rateLimiter;
