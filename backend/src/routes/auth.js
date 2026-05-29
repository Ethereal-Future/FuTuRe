import express from 'express';
import { body, validationResult } from 'express-validator';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createUser, findUser, getUserById, updateUserPassword } from '../auth/userStore.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { consumePendingCredentials } from '../recovery/recoveryStore.js';
 ci/add-migration-smoke-test
import prisma from '../db/client.js';

import prisma from '../db/client.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import { csrfTokenEndpoint } from '../middleware/csrf.js';
import mfaManager from '../security/mfa.js';
import oauth2Provider from '../security/oauth2.js';
import { getConfig } from '../config/env.js';
import { getConfig } from '../config/env.js';
 main

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
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       422:
 *         description: Validation error
 */
router.post('/login', authRateLimiter, userRules, validateBody, async (req, res) => {
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
      const refreshToken = signRefreshToken(payload);
      setRefreshTokenCookie(res, refreshToken);
      return res.json({
        accessToken: signAccessToken(payload),
        recovered: true,
      });
    }
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
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
 * /api/auth/csrf-token:
 *   get:
 *     summary: Get CSRF token for state-mutating requests
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200:
 *         description: CSRF token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 csrfToken: { type: string }
 */
router.get('/csrf-token', csrfTokenEndpoint);

/**
 * @swagger
 * /api/auth/mfa/setup:
 *   post:
 *     summary: Setup MFA (TOTP) for authenticated user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: MFA setup initiated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 secret: { type: string }
 *                 qrCode: { type: string }
 *                 backupCodes: { type: array, items: { type: string } }
 *       401:
 *         description: Unauthorized
 */
router.post('/mfa/setup', requireAuth, async (req, res) => {
  try {
    const { secret, qrCode } = mfaManager.generateSecret(req.user.sub);
    const backupCodes = mfaManager.enableMFA(req.user.sub, secret);
    
    // In production, encrypt and store secret in database
    const encryptionKey = getConfig().security.mfaEncryptionKey || 'default-key';
    const encryptedSecret = mfaManager.encryptSecret(secret, encryptionKey);
    
    res.json({
      secret,
      qrCode,
      backupCodes,
      message: 'Scan the QR code with your authenticator app'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/auth/mfa/verify:
 *   post:
 *     summary: Verify MFA token to complete setup
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 *                 description: 6-digit TOTP code
 *     responses:
 *       200:
 *         description: MFA verified and enabled
 *       403:
 *         description: Invalid MFA token
 */
router.post('/mfa/verify', requireAuth, (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  try {
    const mfa = mfaManager.userMFA.get(req.user.sub);
    if (!mfa) {
      return res.status(400).json({ error: 'MFA setup not initiated' });
    }

    mfaManager.verifyTOTP(req.user.sub, token, mfa.secret);
    
    // In production, mark MFA as verified in database
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
  const state = require('crypto').randomBytes(16).toString('hex');
  
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
