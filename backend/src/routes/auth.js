import express from 'express';
import { body, validationResult } from 'express-validator';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createUser, findUser, getUserById, updateUserPassword } from '../auth/userStore.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/tokens.js';
import {
  createSession,
  getActiveSession,
  listUserSessions,
  revokeSession,
  revokeAllSessions,
} from '../auth/sessionStore.js';
import { requireAuth } from '../middleware/auth.js';
import { sendError, ErrorCodes } from '../middleware/errorHandler.js';
import { consumePendingCredentials } from '../recovery/recoveryStore.js';
import prisma from '../db/client.js';
import { createRateLimiter } from '../middleware/rateLimiter.js';
import {
  recordFailedLogin,
  isAccountLocked,
  unlockAccount,
  clearFailedAttempts,
  getLockoutDuration,
} from '../security/accountLockout.js';
import { getClientIP } from '../middleware/rateLimiter.js';
import logger from '../config/logger.js';
import { csrfTokenEndpoint } from '../middleware/csrf.js';
import mfaManager from '../security/mfa.js';
import oauth2Provider from '../security/oauth2.js';
import { getConfig } from '../config/env.js';

const router = express.Router();

function clearRefreshTokenCookie(res) {
  const config = getConfig();
  const isProduction = config.meta.appEnv === 'production';
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/api/auth',
  });
}

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
  if (!errors.isEmpty())
    return sendError(
      res,
      422,
      ErrorCodes.VALIDATION_INVALID_INPUT,
      'Validation failed',
      errors.array(),
    );
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
 *             $ref: '#/components/schemas/RegisterRequest'
 *           example:
 *             username: alice
 *             password: S3cur3P@ss!
 *     responses:
 *       201:
 *         description: User created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/UserProfile'
 *             example:
 *               user:
 *                 id: usr_01HX
 *                 username: alice
 *                 createdAt: '2026-01-15T10:00:00.000Z'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       409:
 *         description: Username already taken
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Username already taken
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/register', authRateLimiter, userRules, validateBody, async (req, res) => {
  try {
    const { username, password } = req.body;
    const passwordHash = await hashPassword(password);
    const user = createUser(username, passwordHash);
    res.status(201).json({ user });
  } catch (error) {
    sendError(res, 409, ErrorCodes.CONFLICT, error.message);
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
 *             $ref: '#/components/schemas/LoginRequest'
 *           example:
 *             username: alice
 *             password: S3cur3P@ss!
 *     responses:
 *       200:
 *         description: Tokens issued
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *             example:
 *               accessToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *               recovered: false
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid credentials
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       423:
 *         description: Account temporarily locked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 retryAfter: { type: integer }
 *             example:
 *               error: Account is temporarily locked due to too many failed login attempts
 *               retryAfter: 900
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/login', authRateLimiter, userRules, validateBody, async (req, res) => {
  const { username, password } = req.body;
  const ipAddress = getClientIP(req);

  // Check if account is locked
  const locked = await isAccountLocked(username);
  if (locked) {
    const retryAfter = Math.ceil(getLockoutDuration() / 1000);
    return res
      .status(423)
      .set('Retry-After', retryAfter)
      .json({
        success: false,
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Account is temporarily locked due to too many failed login attempts',
          details: { retryAfter },
        },
      });
  }

  const user = await findUser(username);
  if (!user) {
    await recordFailedLogin(username, ipAddress);
    return sendError(res, 401, ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Invalid credentials');
  }

  // Check for pending recovered credentials first
  const recovered = consumePendingCredentials(user.id);
  if (recovered) {
    const valid = await verifyPassword(password, recovered.passwordHash);
    if (valid) {
      updateUserPassword(user.id, recovered.passwordHash);
      await clearFailedAttempts(username);
      const recoveredSession = await createSession(user.id, {
        ipAddress,
        userAgent: req.headers['user-agent'],
      });
      const recoveredPayload = {
        sub: user.id,
        username: user.username,
        role: user.role || 'USER',
        sid: recoveredSession.id,
      };
      const recoveredRefreshToken = signRefreshToken(recoveredPayload);
      setRefreshTokenCookie(res, recoveredRefreshToken);
      return res.json({
        accessToken: signAccessToken(recoveredPayload),
        recovered: true,
        sessionId: recoveredSession.id,
      });
    }
    await recordFailedLogin(username, ipAddress);
    return sendError(res, 401, ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Invalid credentials');
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordFailedLogin(username, ipAddress);
    return sendError(res, 401, ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Invalid credentials');
  }

  // Successful login - clear failed attempts
  await clearFailedAttempts(username);
  const session = await createSession(user.id, {
    ipAddress,
    userAgent: req.headers['user-agent'],
  });
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role || 'USER',
    sid: session.id,
  };
  const refreshToken = signRefreshToken(payload);
  setRefreshTokenCookie(res, refreshToken);
  res.json({
    accessToken: signAccessToken(payload),
    sessionId: session.id,
  });
});

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     description: Uses the HttpOnly `refreshToken` cookie to issue a new access token and rotate the refresh token.
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200:
 *         description: New access token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *             example:
 *               accessToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       401:
 *         description: Invalid or expired refresh token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid or expired refresh token
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken)
    return sendError(res, 401, ErrorCodes.AUTH_INVALID_TOKEN, 'Refresh token missing or expired');
  try {
    const payload = verifyToken(refreshToken);
    if (payload.sid) {
      const session = await getActiveSession(payload.sid);
      if (!session) {
        clearRefreshTokenCookie(res);
        return sendError(res, 401, ErrorCodes.AUTH_INVALID_TOKEN, 'Session expired or revoked');
      }
    }
    const newPayload = {
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
      sid: payload.sid,
    };
    const newRefreshToken = signRefreshToken(newPayload);
    setRefreshTokenCookie(res, newRefreshToken);
    res.json({ accessToken: signAccessToken(newPayload) });
  } catch {
    sendError(res, 401, ErrorCodes.AUTH_INVALID_TOKEN, 'Invalid or expired refresh token');
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Log out (clears refresh token cookie)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *             example:
 *               message: Logged out successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/logout', requireAuth, async (req, res) => {
  if (req.user.sid) {
    await revokeSession(req.user.sid, req.user.sub);
  }
  clearRefreshTokenCookie(res);
  res.json({ message: 'Logged out successfully' });
});

/**
 * @swagger
 * /api/auth/sessions:
 *   get:
 *     summary: List all active sessions for the authenticated user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active sessions
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/sessions', requireAuth, async (req, res) => {
  try {
    const sessions = await listUserSessions(req.user.sub, req.user.sid);
    res.json({ sessions });
  } catch (error) {
    logger.error({ err: error, userId: req.user.sub }, 'Failed to list sessions');
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to list sessions');
  }
});

/**
 * @swagger
 * /api/auth/sessions/{id}:
 *   delete:
 *     summary: Revoke a specific session
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/sessions/:id', requireAuth, async (req, res) => {
  try {
    const revoked = await revokeSession(req.params.id, req.user.sub);
    if (!revoked) {
      return sendError(res, 404, ErrorCodes.NOT_FOUND, 'Session not found');
    }
    if (req.params.id === req.user.sid) {
      clearRefreshTokenCookie(res);
    }
    res.json({ message: 'Session revoked' });
  } catch (error) {
    logger.error({ err: error, sessionId: req.params.id }, 'Failed to revoke session');
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to revoke session');
  }
});

/**
 * @swagger
 * /api/auth/sessions:
 *   delete:
 *     summary: Revoke all sessions (logout everywhere)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 */
router.delete('/sessions', requireAuth, async (req, res) => {
  try {
    const count = await revokeAllSessions(req.user.sub, req.user.sid);
    res.json({ message: 'All other sessions revoked', revokedCount: count });
  } catch (error) {
    logger.error({ err: error, userId: req.user.sub }, 'Failed to revoke all sessions');
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to revoke sessions');
  }
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
 *               $ref: '#/components/schemas/UserProfile'
 *             example:
 *               id: usr_01HX
 *               username: alice
 *               createdAt: '2026-01-15T10:00:00.000Z'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/profile', requireAuth, (req, res) => {
  const user = getUserById(req.user.sub);
  if (!user) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'User not found');
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
    const encryptionKey = getConfig().security.mfaEncryptionKey || 'default-key';
    mfaManager.encryptSecret(secret, encryptionKey);
    res.json({
      secret,
      qrCode,
      backupCodes,
      message: 'Scan the QR code with your authenticator app',
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
 *           example:
 *             username: alice
 *     responses:
 *       200:
 *         description: Account unlocked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *             example:
 *               message: Account alice has been unlocked
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/admin/unlock', requireAuth, async (req, res) => {
  const { username } = req.body;

  const user = getUserById(req.user.sub);
  if (!user?.isAdmin) {
    return sendError(res, 403, ErrorCodes.FORBIDDEN, 'Admin access required');
  }

  try {
    await unlockAccount(username);
    logger.info({ admin: user.username, unlocked: username }, 'Account unlocked by admin');
    res.json({ message: `Account ${username} has been unlocked` });
  } catch (err) {
    logger.error({ err, username }, 'Failed to unlock account');
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to unlock account');
  }
});

router.get('/csrf-token', csrfTokenEndpoint);

router.post('/mfa/setup', requireAuth, async (req, res) => {
  try {
    const { secret, qrCode } = mfaManager.generateSecret(req.user.sub);
    const backupCodes = mfaManager.enableMFA(req.user.sub, secret);
    res.json({
      secret,
      qrCode,
      backupCodes,
      message: 'Scan the QR code with your authenticator app',
    });
  } catch (error) {
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

router.post('/mfa/verify', requireAuth, (req, res) => {
  const { token } = req.body;
  if (!token) return sendError(res, 400, ErrorCodes.VALIDATION_MISSING_FIELD, 'Token required');
  try {
    const mfa = mfaManager.userMFA.get(req.user.sub);
    if (!mfa)
      return sendError(res, 400, ErrorCodes.VALIDATION_INVALID_INPUT, 'MFA setup not initiated');
    mfaManager.verifyTOTP(req.user.sub, token, mfa.secret);
    res.json({ message: 'MFA enabled successfully' });
  } catch (error) {
    sendError(res, 403, ErrorCodes.FORBIDDEN, error.message);
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
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
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
 *         $ref: '#/components/responses/BadRequest'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/oauth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const storedState = req.cookies.oauth_state;

  if (!code || !state || state !== storedState) {
    return sendError(
      res,
      400,
      ErrorCodes.VALIDATION_INVALID_INPUT,
      'Invalid state or authorization code',
    );
  }

  try {
    const clientId = getConfig().oauth.googleClientId;
    const clientSecret = getConfig().oauth.googleClientSecret;
    const redirectUri = `${getConfig().server.baseUrl}/api/auth/oauth/google/callback`;

    // Exchange code for tokens
    const googleTokens = await oauth2Provider.exchangeGoogleCode(
      code,
      clientId,
      clientSecret,
      redirectUri,
    );

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
    res.redirect(
      `${frontendUrl}/auth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`,
    );
  } catch (error) {
    sendError(res, 400, ErrorCodes.INTERNAL_ERROR, error.message);
  }
});

/**
 * /api/auth/data-export:
 *   get:
 *     summary: Export all personal data for the authenticated user (GDPR Art. 15)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: JSON file attachment containing all user data (profile, KYC, transactions, notifications)
 *         content:
 *           application/json:
 *             example:
 *               exportedAt: '2026-06-23T12:00:00.000Z'
 *               data:
 *                 id: usr_01HX
 *                 username: alice
 *                 publicKey: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *                 createdAt: '2026-01-15T10:00:00.000Z'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/data-export', requireAuth, async (req, res) => {
  const userId = req.user.sub;
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        settings: true,
        kycRecord: true,
        sentTxs: {
          select: {
            id: true,
            hash: true,
            assetCode: true,
            amount: true,
            memo: true,
            createdAt: true,
            recipientId: true,
          },
        },
        receivedTxs: {
          select: {
            id: true,
            hash: true,
            assetCode: true,
            amount: true,
            memo: true,
            createdAt: true,
            senderId: true,
          },
        },
        notifications: {
          select: {
            id: true,
            type: true,
            channel: true,
            title: true,
            body: true,
            createdAt: true,
            read: true,
          },
        },
      },
    });
    if (!user) return sendError(res, 404, ErrorCodes.NOT_FOUND, 'User not found');

    const { passwordHash: _omit, ...exportData } = user;

    res.setHeader('Content-Disposition', 'attachment; filename="data-export.json"');
    res.json({ exportedAt: new Date().toISOString(), data: exportData });
  } catch (error) {
    logger.error({ err: error, userId }, 'data-export failed');
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to export user data');
  }
});

/**
 * @swagger
 * /api/auth/users/{id}/role:
 *   put:
 *     summary: Assign a role to a user (admin only)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [USER, COMPLIANCE, ADMIN]
 *     responses:
 *       200:
 *         description: Role updated
 *       400:
 *         description: Invalid role
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 */
router.put('/users/:id/role', requireAuth, async (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  const { role } = req.body;
  const validRoles = ['USER', 'COMPLIANCE', 'ADMIN'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be USER, COMPLIANCE, or ADMIN' });
  }
  try {
    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, username: true, role: true },
    });
    res.json(updated);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * @swagger
 * /api/auth/account:
 *   delete:
 *     summary: Request account deletion and anonymise personal data (GDPR Art. 17)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account soft-deleted and data anonymised; permanent deletion scheduled in 30 days
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 scheduledPermanentDeletion: { type: string, format: date-time }
 *             example:
 *               message: Account scheduled for deletion. Personal data has been anonymised.
 *               scheduledPermanentDeletion: '2026-07-23T12:00:00.000Z'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.delete('/account', requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const ANON_PUBLIC_KEY = `ANONYMIZED-${userId.substring(0, 8)}`;
  const ANON_USERNAME = `deleted-${userId.substring(0, 8)}`;
  const PERMANENT_DELETE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          publicKey: ANON_PUBLIC_KEY,
          username: ANON_USERNAME,
          passwordHash: '',
        },
      });

      await tx.kYCRecord.updateMany({
        where: { userId },
        data: {
          fullName: '[REDACTED]',
          dateOfBirth: new Date('1970-01-01'),
          nationality: '[REDACTED]',
          documentType: '[REDACTED]',
          documentNumber: '[REDACTED]',
          address: '[REDACTED]',
          phoneNumber: null,
          email: null,
        },
      });

      await tx.transaction.updateMany({
        where: { OR: [{ senderId: userId }, { recipientId: userId }] },
        data: { memo: null },
      });
    });

    logger.info({ userId }, 'GDPR account deletion: data anonymised');

    res.json({
      message: 'Account scheduled for deletion. Personal data has been anonymised.',
      scheduledPermanentDeletion: PERMANENT_DELETE_DATE.toISOString(),
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return sendError(res, 404, ErrorCodes.NOT_FOUND, 'User not found');
    }
    logger.error({ err: error, userId }, 'account deletion failed');
    sendError(res, 500, ErrorCodes.INTERNAL_ERROR, 'Failed to delete account');
  }
});

// MFA Routes
// POST /api/auth/mfa/setup - Enable MFA and generate recovery codes
router.post('/mfa/setup', [body('totp').notEmpty().isString()], validateBody, async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { totp: _totp } = req.body;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Generate recovery codes
    const recoveryCodes = Array.from({ length: 10 }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );

    // Hash and store recovery codes
    const hashedCodes = await Promise.all(recoveryCodes.map((code) => bcrypt.hash(code, 10)));

    // Create/update MFA settings
    await prisma.mFASettings.upsert({
      where: { userId },
      create: {
        userId,
        secret: req.body.secret, // encrypted secret would be passed from client
        enabled: true,
      },
      update: {
        enabled: true,
      },
    });

    // Save recovery codes
    await prisma.recoveryCode.deleteMany({ where: { userId } });
    await prisma.recoveryCode.createMany({
      data: hashedCodes.map((codeHash) => ({
        userId,
        codeHash,
      })),
    });

    res.json({
      message: 'MFA enabled successfully',
      recoveryCodes, // Return unhashed codes only once during setup
      warning: 'Store these recovery codes in a safe place. Each code can only be used once.',
    });
  } catch (error) {
    logger.error({ err: error }, 'MFA setup failed');
    res.status(500).json({ error: 'Failed to enable MFA' });
  }
});

// POST /api/auth/mfa/regenerate - Regenerate recovery codes
router.post('/mfa/regenerate', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Generate new recovery codes
    const recoveryCodes = Array.from({ length: 10 }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );

    // Hash and store new codes
    const hashedCodes = await Promise.all(recoveryCodes.map((code) => bcrypt.hash(code, 10)));

    // Delete old codes and save new ones
    await prisma.recoveryCode.deleteMany({ where: { userId } });
    await prisma.recoveryCode.createMany({
      data: hashedCodes.map((codeHash) => ({
        userId,
        codeHash,
      })),
    });

    res.json({
      message: 'Recovery codes regenerated',
      recoveryCodes,
      warning: 'All previous recovery codes are now invalid.',
    });
  } catch (error) {
    logger.error({ err: error }, 'Recovery code regeneration failed');
    res.status(500).json({ error: 'Failed to regenerate recovery codes' });
  }
});

// POST /api/auth/mfa/verify-recovery - Verify recovery code and log in
router.post(
  '/mfa/verify-recovery',
  [body('publicKey').notEmpty().isString(), body('recoveryCode').notEmpty().isString()],
  validateBody,
  async (req, res) => {
    try {
      const { publicKey, recoveryCode } = req.body;

      // Find user by public key
      const user = await prisma.user.findUnique({
        where: { publicKey },
        include: { recoveryCodes: true, mfaSettings: true },
      });

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Check if MFA is enabled
      if (!user.mfaSettings?.enabled) {
        return res.status(400).json({ error: 'MFA not enabled' });
      }

      // Find matching recovery code
      let validCode = null;
      for (const code of user.recoveryCodes) {
        if (!code.used && (await bcrypt.compare(recoveryCode, code.codeHash))) {
          validCode = code;
          break;
        }
      }

      if (!validCode) {
        return res.status(401).json({ error: 'Invalid recovery code' });
      }

      // Mark code as used
      await prisma.recoveryCode.update({
        where: { id: validCode.id },
        data: { used: true, usedAt: new Date() },
      });

      // Generate JWT token
      const token = signAccessToken({
        sub: user.id,
        username: user.username,
        role: user.role || 'USER',
      });

      res.json({
        token,
        user: {
          id: user.id,
          publicKey: user.publicKey,
        },
        message: 'Recovery code accepted. Please update your TOTP device.',
      });
    } catch (error) {
      logger.error({ err: error }, 'Recovery code verification failed');
      res.status(500).json({ error: 'Failed to verify recovery code' });
    }
  },
);

// GET /api/auth/mfa/status - Check MFA status
router.get('/mfa/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const mfaSettings = await prisma.mFASettings.findUnique({
      where: { userId },
    });

    const availableRecoveryCodes = await prisma.recoveryCode.count({
      where: { userId, used: false },
    });

    res.json({
      enabled: mfaSettings?.enabled ?? false,
      availableRecoveryCodes,
      lastUsed: mfaSettings?.lastUsed,
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to get MFA status');
    res.status(500).json({ error: 'Failed to get MFA status' });
  }
});

export default router;
