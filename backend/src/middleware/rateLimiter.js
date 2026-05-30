import rateLimit from 'express-rate-limit';
import { isWhitelisted } from '../security/ipWhitelist.js';
import logger from '../config/logger.js';

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
      const username = req.body?.username || 'unknown';

      logger.warn({
        ip: clientIP,
        path: req.path,
        method: req.method,
        username,
        whitelist: isWhitelisted(clientIP),
      }, 'Rate limit exceeded');
      
      // Set Retry-After header
      const retryAfter = Math.ceil(windowMs / 1000);
      res.set('Retry-After', retryAfter.toString());
      
      res.status(429).json({
        error: options.message.error || message,
        statusCode: 429,
        retryAfter,
      });
    },
  });

  return limiter;
}

const rateLimiter = createRateLimiter();

export { createRateLimiter, getClientIP };

export default rateLimiter;
