import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { isWhitelisted } from '../security/ipWhitelist.js';
import logger from '../config/logger.js';

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
    skip = (req) => isWhitelisted(getClientIP(req)),
    keyGenerator = (req) => ipKeyGenerator(getClientIP(req)),
  } = options;

  const limiter = rateLimit({
    windowMs,
    max,
    message: {
      error: message,
      statusCode: 429,
      retryAfter: Math.ceil(windowMs / 1000),
    },
    standardHeaders,
    legacyHeaders,
    skip,
    keyGenerator,
    handler: (req, res, _next, opts) => {
      const clientIP = getClientIP(req);
      const username = req.body?.username || 'unknown';

      logger.warn({
        ip: clientIP,
        userId: getUserRateLimitKey(req),
        path: req.path,
        method: req.method,
        username,
        whitelist: isWhitelisted(clientIP),
      }, 'Rate limit exceeded');
      
      const retryAfter = Math.ceil(windowMs / 1000);
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

export { createRateLimiter, createPerUserRateLimiter, getClientIP, getUserRateLimitKey };

export default rateLimiter;
