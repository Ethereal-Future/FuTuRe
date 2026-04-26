import { verifyToken } from '../auth/tokens.js';

// Admin role check middleware
// For demo purposes, we check if user has an 'admin' role in their JWT payload
// In production, this should check against a database or external auth service
export function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  
  try {
    const user = verifyToken(auth.slice(7));
    req.user = user;
    
    // Check if user has admin role
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
