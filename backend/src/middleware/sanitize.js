import { sanitizeObject, logSanitizationEvent } from '../utils/sanitize.js';

/**
 * Express middleware that sanitizes req.body, req.query, and req.params in-place.
 * Runs before route handlers so all downstream code receives clean input.
 */
export function sanitizeInputs(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    const clean = sanitizeObject(req.body);
    // Log any fields that were modified
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        logSanitizationEvent(key, req.body[key], clean[key], req);
      }
    }
    req.body = clean;
  }

  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }

  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeObject(req.params);
  }

  next();
}
