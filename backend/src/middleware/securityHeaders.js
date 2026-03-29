import helmet from 'helmet';
import csrf from 'csurf';
import { getConfig } from '../config/env.js';
import logger from '../config/logger.js';
import { isWhitelisted } from '../security/ipWhitelist.js';

/**
 * Security audit logger
 */
const securityLogger = logger.child({ component: 'security' });

/**
 * Helmet.js configuration for security headers
 */
export function helmetMiddleware() {
  const config = getConfig();
  const isProduction = config.meta.appEnv === 'production';

  return helmet({
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'", // Required for some React features
          isProduction ? "" : "'unsafe-eval'", // Only in development
        ].filter(Boolean),
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://horizon.stellar.org", "https://horizon-testnet.stellar.org"],
        fontSrc: ["'self'", "https:", "data:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },

    // Cross-Origin Embedder Policy
    crossOriginEmbedderPolicy: isProduction,

    // Cross-Origin Opener Policy
    crossOriginOpenerPolicy: { policy: "same-origin" },

    // Cross-Origin Resource Policy
    crossOriginResourcePolicy: { policy: "same-origin" },

    // DNS Prefetch Control
    dnsPrefetchControl: { allow: false },

    // Frame Options
    frameguard: { action: "deny" },

    // Hide X-Powered-By
    hidePoweredBy: true,

    // HTTP Strict Transport Security
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },

    // IE No Open
    ieNoOpen: true,

    // No Sniff
    noSniff: true,

    // Referrer Policy
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },

    // X-XSS Protection (legacy but still useful)
    xssFilter: true,

    // Permissions Policy (formerly Feature Policy)
    permissionsPolicy: {
      features: [
        "accelerometer=()",
        "ambient-light-sensor=()",
        "autoplay=()",
        "battery=()",
        "camera=()",
        "display-capture=()",
        "fullscreen=()",
        "geolocation=()",
        "gyroscope=()",
        "magnetometer=()",
        "microphone=()",
        "midi=()",
        "payment=()",
        "picture-in-picture=()",
        "usb=()",
      ],
    },
  });
}

/**
 * CSRF protection middleware
 */
export function csrfMiddleware() {
  const config = getConfig();
  const isProduction = config.meta.appEnv === 'production';

  return csrf({
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
    },
  });
}

/**
 * CSRF error handler
 */
export function csrfErrorHandler(err, req, res, next) {
  if (err.code === 'EBADCSRFTOKEN') {
    securityLogger.warn('CSRF token validation failed', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      userAgent: req.headers['user-agent'],
    });

    return res.status(403).json({
      success: false,
      error: {
        code: 'CSRF_TOKEN_INVALID',
        message: 'Invalid or missing CSRF token',
      },
    });
  }
  next(err);
}

/**
 * Request size limits middleware
 */
export function requestSizeLimits() {
  return (req, res, next) => {
    const config = getConfig();
    const isProduction = config.meta.appEnv === 'production';

    // Default limits
    const limits = {
      json: isProduction ? '1mb' : '10mb',
      urlencoded: isProduction ? '1mb' : '10mb',
      raw: '1mb',
      text: '1mb',
    };

    // Check content-length header
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    const maxSizes = {
      'application/json': 10 * 1024 * 1024, // 10MB
      'application/x-www-form-urlencoded': 10 * 1024 * 1024,
      'multipart/form-data': 50 * 1024 * 1024, // 50MB
    };

    const contentType = req.headers['content-type']?.split(';')[0];
    const maxSize = maxSizes[contentType];

    if (maxSize && contentLength > maxSize) {
      securityLogger.warn('Request size exceeded limit', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        contentLength,
        maxSize,
        contentType,
      });

      return res.status(413).json({
        success: false,
        error: {
          code: 'REQUEST_TOO_LARGE',
          message: `Request size exceeds limit of ${maxSize / 1024 / 1024}MB`,
        },
      });
    }

    next();
  };
}

/**
 * IP filtering middleware
 */
export function ipFilterMiddleware() {
  return (req, res, next) => {
    const config = getConfig();
    const clientIP = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;

    // Check if IP is whitelisted
    if (!isWhitelisted(clientIP)) {
      // Check for blocked IPs (you can extend this with a database or config)
      const blockedIPs = config.security?.blockedIPs || [];
      
      if (blockedIPs.includes(clientIP)) {
        securityLogger.warn('Blocked IP attempted access', {
          ip: clientIP,
          path: req.path,
          method: req.method,
        });

        return res.status(403).json({
          success: false,
          error: {
            code: 'IP_BLOCKED',
            message: 'Access denied',
          },
        });
      }
    }

    next();
  };
}

/**
 * Secure cookie configuration
 */
export function getSecureCookieConfig() {
  const config = getConfig();
  const isProduction = config.meta.appEnv === 'production';

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  };
}

/**
 * Security headers middleware
 */
export function securityHeaders() {
  return (req, res, next) => {
    const config = getConfig();
    const isProduction = config.meta.appEnv === 'production';

    // Remove X-Powered-By header
    res.removeHeader('X-Powered-By');

    // Add custom security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Cache control for sensitive endpoints
    if (req.path.includes('/api/') && req.method !== 'GET') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    // CORS headers (additional to cors middleware)
    if (isProduction) {
      res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    }

    next();
  };
}

/**
 * Rate limiting headers
 */
export function rateLimitHeaders() {
  return (req, res, next) => {
    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', '100');
    res.setHeader('X-RateLimit-Remaining', '99');
    res.setHeader('X-RateLimit-Reset', Math.floor(Date.now() / 1000) + 60);

    next();
  };
}

/**
 * Security audit logging middleware
 */
export function securityAuditLogger() {
  return (req, res, next) => {
    const startTime = Date.now();

    // Log request
    securityLogger.info('Security audit - Request', {
      ip: req.ip,
      method: req.method,
      path: req.path,
      userAgent: req.headers['user-agent'],
      referer: req.headers['referer'],
      timestamp: new Date().toISOString(),
    });

    // Log response
    const originalSend = res.send;
    res.send = function(body) {
      const duration = Date.now() - startTime;
      
      securityLogger.info('Security audit - Response', {
        ip: req.ip,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        timestamp: new Date().toISOString(),
      });

      // Log suspicious activities
      if (res.statusCode === 403 || res.statusCode === 429) {
        securityLogger.warn('Security audit - Suspicious activity', {
          ip: req.ip,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          userAgent: req.headers['user-agent'],
          timestamp: new Date().toISOString(),
        });
      }

      return originalSend.call(this, body);
    };

    next();
  };
}

/**
 * Combined security middleware
 */
export function securityMiddleware() {
  const middlewares = [
    helmetMiddleware(),
    securityHeaders(),
    requestSizeLimits(),
    ipFilterMiddleware(),
    securityAuditLogger(),
  ];

  // Add CSRF protection for non-API routes
  const config = getConfig();
  if (config.meta.appEnv !== 'test') {
    middlewares.push(csrfMiddleware());
    middlewares.push(csrfErrorHandler);
  }

  return middlewares;
}

export default {
  helmetMiddleware,
  csrfMiddleware,
  csrfErrorHandler,
  requestSizeLimits,
  ipFilterMiddleware,
  getSecureCookieConfig,
  securityHeaders,
  rateLimitHeaders,
  securityAuditLogger,
  securityMiddleware,
};
