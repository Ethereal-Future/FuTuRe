import { verifyToken } from '../auth/tokens.js';
import { getActiveSession } from '../auth/sessionStore.js';
import prisma from '../db/client.js';

export async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  try {
    const payload = verifyToken(auth.slice(7));
    if (payload.sid) {
      const session = await getActiveSession(payload.sid);
      if (!session) {
        return res.status(401).json({ error: 'Session expired or revoked' });
      }
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
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
