import { createHmac, timingSafeEqual } from 'crypto';
import logger from '../config/logger.js';

/**
 * Verify an HMAC-SHA256 signature from an incoming webhook request.
 * Uses timingSafeEqual to prevent timing attacks.
 *
 * @param {Buffer} rawBody - Raw request body buffer (before JSON parsing)
 * @param {string} signature - Signature from the request header (hex string)
 * @param {string} secret - The shared signing secret
 * @returns {boolean}
 */
export function verifyHmacSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Express middleware that verifies incoming webhook signatures.
 * Reads the secret from WEBHOOK_SIGNING_SECRET env variable.
 * Returns 401 on failure without revealing why.
 */
export function webhookSignatureMiddleware(req, res, next) {
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    logger.warn('WEBHOOK_SIGNING_SECRET not set — skipping signature verification');
    return next();
  }

  const signature = req.headers['x-webhook-signature'] ?? req.headers['x-hub-signature-256'];
  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));

  if (!verifyHmacSignature(rawBody, signature, secret)) {
    logger.warn({ ip: req.ip, path: req.path }, 'Invalid webhook signature rejected');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
