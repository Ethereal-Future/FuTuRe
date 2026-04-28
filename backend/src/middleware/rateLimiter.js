import rateLimit from 'express-rate-limit';
import { isWhitelisted } from '../security/ipWhitelist.js';
import { logger } from '../utils/logger.js';

export const rateLimitLogger = logger.child({ component: 'rateLimiter' });

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
}

function createRateLimiter(options = {}) {
  const {
    windowMs = 60000,
    max = 100,
    message = 'Too many requests, please try again later.',
    standardHeaders = true,
    legacyHeaders = false,
    skip = (req) => isWhitelisted(getClientIP(req)),
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
    keyGenerator: (req) => getClientIP(req),
    handler: (req, res, next, options) => {
      const clientIP = getClientIP(req);
      rateLimitLogger.warn({
        ip: clientIP,
        path: req.path,
        method: req.method,
        whitelist: isWhitelisted(clientIP),
      }, 'Rate limit exceeded');
      res.status(429).json({
        error: options.message.error || message,
        statusCode: 429,
        retryAfter: options.message.retryAfter || Math.ceil(windowMs / 1000),
      });
    },
  });

  return limiter;
}

const rateLimiter = createRateLimiter();

export { createRateLimiter, getClientIP };

export default rateLimiter;
