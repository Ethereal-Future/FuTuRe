import crypto from 'crypto';

const CSRF_TOKEN_LENGTH = 32;
const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'csrf-token';

// In-memory store for CSRF tokens (in production, use Redis or database)
const csrfTokens = new Map();

/**
 * Generate a CSRF token for the session
 */
export function generateCSRFToken() {
  const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  csrfTokens.set(token, { expiresAt });
  return token;
}

/**
 * Validate a CSRF token
 */
export function validateCSRFToken(token) {
  if (!token) return false;
  const tokenData = csrfTokens.get(token);
  if (!tokenData) return false;
  if (tokenData.expiresAt < Date.now()) {
    csrfTokens.delete(token);
    return false;
  }
  return true;
}

/**
 * Middleware to issue CSRF token on GET requests
 */
export function csrfTokenMiddleware(req, res, next) {
  if (req.method === 'GET') {
    const token = generateCSRFToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });
    res.locals.csrfToken = token;
  }
  next();
}

/**
 * Middleware to validate CSRF token on state-mutating requests
 */
export function validateCSRFMiddleware(req, res, next) {
  // Skip CSRF validation for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const token = req.headers[CSRF_HEADER] || req.body?.csrfToken;
  
  if (!token) {
    return res.status(403).json({ error: 'CSRF token missing' });
  }

  if (!validateCSRFToken(token)) {
    return res.status(403).json({ error: 'Invalid or expired CSRF token' });
  }

  next();
}

/**
 * Endpoint to get CSRF token
 */
export function csrfTokenEndpoint(req, res) {
  const token = generateCSRFToken();
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000
  });
  res.json({ csrfToken: token });
}
