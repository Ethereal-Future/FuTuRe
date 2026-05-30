import express from 'express';
import { body, validationResult } from 'express-validator';
import { randomBytes } from 'crypto';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createUser, findUser, getUserById, updateUserPassword } from '../auth/userStore.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { consumePendingCredentials } from '../recovery/recoveryStore.js';
import prisma from '../db/client.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { recordFailedLogin, isAccountLocked, unlockAccount, clearFailedAttempts, getLockoutDuration } from '../security/accountLockout.js';
import { getClientIP } from '../middleware/rateLimiter.js';
import logger from '../config/logger.js';
import { csrfTokenEndpoint } from '../middleware/csrf.js';
import mfaManager from '../security/mfa.js';
import oauth2Provider from '../security/oauth2.js';
import { getConfig } from '../config/env.js';

const router = express.Router();

function setRefreshTokenCookie(res, refreshToken) {
  const config = getConfig();
  const isProduction = config.meta.appEnv === 'production';

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/auth',
  });
}

// Stricter rate limit for login endpoint (5 req/15min)
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later.',
});

const validateBody = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
  next();
};

const userRules = [
  body('username').trim().isLength({ min: 3, max: 32 }).withMessage('Username must be 3-32 chars'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 chars'),
];

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 32
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       201:
 *         description: User created
 *       409:
 *         description: Username already taken
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       422:
 *         description: Validation error
 */
router.post('/register', authRateLimiter, userRules, validateBody, async (req, res) => {
  try {
    const { username, password } = req.body;
    const passwordHash = await hashPassword(password);
    const user = createUser(username, passwordHash);
    res.status(201).json({ user });
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Log in and receive JWT tokens
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, password]
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tokens issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken: { type: string }
 *                 recovered: { type: boolean }
 *       401:
 *         description: Invalid credentials
 *       423:
 *         description: Account locked
 *       422:
 *         description: Validation error
 */
const loginRateLimiter = createRateLimiter({
  windowMs: 60000,
  max: 10,
  message: 'Too many login attempts, please try again later.',
});

router.post('/login', loginRateLimiter, userRules, validateBody, async (req, res) => {
  const { username, password } = req.body;
  const ipAddress = getClientIP(req);

  // Check if account is locked
  const locked = await isAccountLocked(username);
  if (locked) {
    const retryAfter = Math.ceil(getLockoutDuration() / 1000);
    return res.status(423).set('Retry-After', retryAfter).json({
      error: 'Account is temporarily locked due to too many failed login attempts',
      retryAfter,
    });
  }

  const user = findUser(username);
  if (!user) {
    await recordFailedLogin(username, ipAddress);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Check for pending recovered credentials first
  const recovered = consumePendingCredentials(user.id);
  if (recovered) {
    const valid = await verifyPassword(password, recovered.passwordHash);
    if (valid) {
      updateUserPassword(user.id, recovered.passwordHash);
      await clearFailedAttempts(username);
      const payload = { sub: user.id, username: user.username };
      const refreshToken = signRefreshToken(payload);
      setRefreshTokenCookie(res, refreshToken);
      return res.json({
        accessToken: signAccessToken(payload),
        recovered: true,
      });
    }
    await recordFailedLogin(username, ipAddress);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordFailedLogin(username, ipAddress);
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Successful login - clear failed attempts
  await clearFailedAttempts(username);
  const payload = { sub: user.id, username: user.username };
  const refreshToken = signRefreshToken(payload);
  setRefreshTokenCookie(res, refreshToken);
  res.json({
    accessToken: signAccessToken(payload),
  });
});

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200:
 *         description: New access token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken: { type: string }
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post('/refresh', (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) return res.status(401).json({ error: 'Refresh token missing or expired' });
  try {
    const { sub, username } = verifyToken(refreshToken);
    const newRefreshToken = signRefreshToken({ sub, username });
    setRefreshTokenCookie(res, newRefreshToken);
    res.json({ accessToken: signAccessToken({ sub, username }) });
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Log out (client should discard tokens)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out
 *       401:
 *         description: Unauthorized
 */
router.post('/logout', requireAuth, (_req, res) => {
  res.json({ message: 'Logged out successfully' });
});

/**
 * @swagger
 * /api/auth/profile:
 *   get:
 *     summary: Get authenticated user profile
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string }
 *                 username: { type: string }
 *                 createdAt: { type: string, format: date-time }
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 */
router.get('/profile', requireAuth, (req, res) => {
  const user = getUserById(req.user.sub);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username, createdAt: user.createdAt });
});

/**
 * @swagger
 * /api/auth/admin/unlock:
 *   post:
 *     summary: Admin endpoint to manually unlock an account
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username:
 *                 type: string
 *     responses:
 *       200:
 *         description: Account unlocked
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (not admin)
 */
router.post('/admin/unlock', requireAuth, async (req, res) => {
  const { username } = req.body;

  const user = getUserById(req.user.sub);
  if (!user?.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    await unlockAccount(username);
    logger.info({ admin: user.username, unlocked: username }, 'Account unlocked by admin');
    res.json({ message: `Account ${username} has been unlocked` });
  } catch (err) {
    logger.error({ err, username }, 'Failed to unlock account');
    res.status(500).json({ error: 'Failed to unlock account' });
  }
});

router.get('/csrf-token', csrfTokenEndpoint);

router.post('/mfa/setup', requireAuth, async (req, res) => {
  try {
    const { secret, qrCode } = mfaManager.generateSecret(req.user.sub);
    const backupCodes = mfaManager.enableMFA(req.user.sub, secret);
    res.json({ secret, qrCode, backupCodes, message: 'Scan the QR code with your authenticator app' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/mfa/verify', requireAuth, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    const mfa = mfaManager.userMFA.get(req.user.sub);
    if (!mfa) return res.status(400).json({ error: 'MFA setup not initiated' });
    mfaManager.verifyTOTP(req.user.sub, token, mfa.secret);
    res.json({ message: 'MFA enabled successfully' });
  } catch (error) {
    res.status(403).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auth/oauth/google:
 *   get:
 *     summary: Redirect to Google OAuth2 login
 *     tags: [Auth]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: CSRF state parameter
 *     responses:
 *       302:
 *         description: Redirect to Google OAuth2 consent screen
 */
router.get('/oauth/google', (req, res) => {
  const clientId = getConfig().oauth.googleClientId;
  const redirectUri = `${getConfig().server.baseUrl}/api/auth/oauth/google/callback`;
  const state = randomBytes(16).toString('hex');
  
  // Store state in session/cookie for verification
  res.cookie('oauth_state', state, { httpOnly: true, maxAge: 10 * 60 * 1000 });
  
  const authUrl = oauth2Provider.getGoogleAuthURL(clientId, redirectUri, state);
  res.redirect(authUrl);
});

/**
 * @swagger
 * /api/auth/oauth/google/callback:
 *   get:
 *     summary: Google OAuth2 callback handler
 *     tags: [Auth]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: state
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redirect to frontend with tokens
 *       400:
 *         description: Invalid state or authorization code
 */
router.get('/oauth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const storedState = req.cookies.oauth_state;
  
  if (!code || !state || state !== storedState) {
    return res.status(400).json({ error: 'Invalid state or authorization code' });
  }

  try {
    const clientId = getConfig().oauth.googleClientId;
    const clientSecret = getConfig().oauth.googleClientSecret;
    const redirectUri = `${getConfig().server.baseUrl}/api/auth/oauth/google/callback`;
    
    // Exchange code for tokens
    const googleTokens = await oauth2Provider.exchangeGoogleCode(code, clientId, clientSecret, redirectUri);
    
    // Get user info
    const userInfo = await oauth2Provider.getGoogleUserInfo(googleTokens.access_token);
    
    // Find or create user
    let user = findUser(userInfo.email);
    if (!user) {
      user = createUser(userInfo.email, ''); // OAuth users don't have passwords
    }
    
    // Generate JWT tokens
    const payload = { sub: user.id, username: user.username };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);
    
    // Redirect to frontend with tokens
    const frontendUrl = getConfig().frontend.baseUrl;
    res.redirect(`${frontendUrl}/auth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/auth/account
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    
    // Soft delete the user (sets deletedAt timestamp)
    const deletedUser = await prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date() },
    });

    res.json({
      message: 'Account deleted successfully',
      deletedAt: deletedUser.deletedAt,
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
