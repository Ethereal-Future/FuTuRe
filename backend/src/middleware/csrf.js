import crypto from 'crypto';
import { createRedisBackend } from '../cache/redis.js';
import logger from '../config/logger.js';

const CSRF_TOKEN_LENGTH = 32;
const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'csrf-token';
const CSRF_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours

// Fallback in-memory store for test environments or when Redis is unavailable
const csrfTokensFallback = new Map();

let redisBackend = null;

/**
 * Initialize Redis backend for CSRF token storage
 */
async function initRedis() {
  if (!redisBackend) {
    const redisUrl = process.env.REDIS_URL;
    redisBackend = createRedisBackend(redisUrl);
    if (redisBackend.client) {
      try {
        await redisBackend.connect();
        logger.debug('CSRF Redis backend initialized');
      } catch (err) {
        logger.warn('CSRF Redis connection failed, falling back to in-memory store', { error: err.message });
      }
    }
  }
  return redisBackend;
}

/**
 * Generate a CSRF token for the session
 */
export async function generateCSRFToken() {
  const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
  const redis = await initRedis();

  if (redis && redis.isAvailable()) {
    await redis.set(`csrf:${token}`, { createdAt: Date.now() }, CSRF_TOKEN_TTL_SECONDS);
  } else {
    // Fallback: use in-memory store for test environments
    csrfTokensFallback.set(token, {
      expiresAt: Date.now() + CSRF_TOKEN_TTL_SECONDS * 1000
    });
  }

  return token;
}

/**
 * Validate a CSRF token
 */
export async function validateCSRFToken(token) {
  if (!token) return false;

  const redis = await initRedis();

  if (redis && redis.isAvailable()) {
    const tokenData = await redis.get(`csrf:${token}`);
    if (tokenData) {
      // Token is valid; optionally delete on use (single-use tokens)
      // For now, let Redis handle expiry with TTL
      return true;
    }
    return false;
  } else {
    // Fallback: use in-memory store for test environments
    const tokenData = csrfTokensFallback.get(token);
    if (!tokenData) return false;
    if (tokenData.expiresAt < Date.now()) {
      csrfTokensFallback.delete(token);
      return false;
    }
    return true;
  }
}

/**
 * Middleware to issue CSRF token on GET requests
 */
export async function csrfTokenMiddleware(req, res, next) {
  if (req.method === 'GET') {
    try {
      const token = await generateCSRFToken();
      res.cookie(CSRF_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000
      });
      res.locals.csrfToken = token;
    } catch (err) {
      logger.warn('CSRF token generation failed', { error: err.message });
    }
  }
  next();
}

/**
 * Middleware to validate CSRF token on state-mutating requests
 */
export async function validateCSRFMiddleware(req, res, next) {
  // Skip CSRF validation for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const token = req.headers[CSRF_HEADER] || req.body?.csrfToken;

  if (!token) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  try {
    const isValid = await validateCSRFToken(token);
    if (!isValid) {
      return res.status(403).json({ error: 'Invalid or expired CSRF token' });
    }
  } catch (err) {
    logger.error('CSRF token validation error', { error: err.message });
    return res.status(403).json({ error: 'CSRF token validation failed' });
  }

  next();
}

/**
 * Endpoint to get CSRF token
 */
export async function csrfTokenEndpoint(req, res) {
  try {
    const token = await generateCSRFToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });
    res.json({ csrfToken: token });
  } catch (err) {
    logger.error('CSRF token endpoint error', { error: err.message });
    res.status(500).json({ error: 'Failed to generate CSRF token' });
  }
}
