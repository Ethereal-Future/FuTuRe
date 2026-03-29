import express from 'express';
import { body, validationResult } from 'express-validator';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createUser, findUser, getUserById, updateUserPassword } from '../auth/userStore.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { consumePendingCredentials } from '../recovery/recoveryStore.js';

const router = express.Router();

const validateBody = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
  next();
};

const userRules = [
  body('username').trim().isLength({ min: 3, max: 32 }).withMessage('Username must be 3-32 chars'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 chars'),
];

// POST /api/auth/register
router.post('/register', userRules, validateBody, async (req, res) => {
  try {
    const { username, password } = req.body;
    const passwordHash = await hashPassword(password);
    const user = createUser(username, passwordHash);
    res.status(201).json({ user });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

// POST /api/auth/login
router.post('/login', userRules, validateBody, async (req, res) => {
  const { username, password } = req.body;
  const user = findUser(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  // Check for pending recovered credentials first
  const recovered = consumePendingCredentials(user.id);
  if (recovered) {
    const valid = await verifyPassword(password, recovered.passwordHash);
    if (valid) {
      updateUserPassword(user.id, recovered.passwordHash);
      const payload = { sub: user.id, username: user.username };
      return res.json({
        accessToken: signAccessToken(payload),
        refreshToken: signRefreshToken(payload),
        recovered: true,
      });
    }
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const payload = { sub: user.id, username: user.username };
  res.json({
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  });
});

// POST /api/auth/refresh
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  try {
    const { sub, username } = verifyToken(refreshToken);
    res.json({ accessToken: signAccessToken({ sub, username }) });
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// POST /api/auth/logout  (client should discard tokens; server-side blacklist can be added later)
router.post('/logout', requireAuth, (_req, res) => {
  res.json({ message: 'Logged out successfully' });
});

// GET /api/auth/profile
router.get('/profile', requireAuth, (req, res) => {
  const user = getUserById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username, createdAt: user.createdAt });
});

export default router;
