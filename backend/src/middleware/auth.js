import { verifyToken } from '../auth/tokens.js';
import { getActiveSession } from '../auth/sessionStore.js';

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
