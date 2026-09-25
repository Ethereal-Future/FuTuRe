import { verifyToken } from '../auth/tokens.js';
import { getActiveSession } from '../auth/sessionStore.js';
import prisma from '../db/client.js';

// RFC 6750 Bearer scheme with a three-part JWT (header.payload.signature).
const BEARER_RE = /^Bearer +([A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_.+/=]*)$/;

function unauthorized(res, error, code) {
  res.set('WWW-Authenticate', `Bearer error="invalid_token", error_description="${error}"`);
  return res.status(401).json({ error, code });
}

export async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const match = typeof auth === 'string' ? auth.match(BEARER_RE) : null;
  if (!match) {
    return unauthorized(res, 'Missing or invalid Authorization header', 'INVALID_TOKEN');
  }
  let payload;
  try {
    payload = verifyToken(match[1]);
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      return unauthorized(res, 'Token expired', 'TOKEN_EXPIRED');
    }
    return unauthorized(res, 'Invalid token', 'INVALID_TOKEN');
  }
  try {
    if (payload.sid) {
      const session = await getActiveSession(payload.sid);
      if (!session) {
        return unauthorized(res, 'Session expired or revoked', 'SESSION_REVOKED');
      }
    }
  } catch {
    return res.status(503).json({ error: 'Unable to verify session', code: 'SESSION_CHECK_FAILED' });
  }
  req.user = payload;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
}

// Verifies the authenticated user's own Stellar public key matches the
// account/aggregate id in the route param, so a caller can't read or act on
// another user's account by guessing their public key. Admins bypass the check.
export function requireOwnAccount(paramName = 'accountId') {
  return async (req, res, next) => {
    if (req.user?.role === 'ADMIN') return next();
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user?.sub },
        select: { publicKey: true },
      });
      if (!user || user.publicKey !== req.params[paramName]) {
        return res.status(403).json({ error: 'You do not have access to this account' });
      }
      next();
    } catch {
      res.status(500).json({ error: 'Failed to verify account ownership' });
    }
  };
}

// Returns the stable identity used to scope idempotency keys. Prefers the
// authenticated user id (req.user.id, falling back to the JWT subject) so
// keys are isolated per user; unauthenticated callers are bucketed under
// 'anonymous' and must be rejected by requireIdempotencyAuth on private routes.
export function getIdempotencyScope(req) {
  return req.user?.id || req.user?.sub || 'anonymous';
}

// Guards private endpoints that accept an idempotency key: if a key is
// supplied without an authenticated user, reject the request so an anonymous
// caller can never read or poison another user's cached response.
export function requireIdempotencyAuth(req, res, next) {
  const idempotencyKey = req.headers['idempotency-key'];
  if (idempotencyKey && !req.user) {
    return res.status(401).json({ error: 'Authentication required for idempotent requests' });
  }
  next();
}
