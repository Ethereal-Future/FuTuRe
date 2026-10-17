import express from 'express';
import {
  mobileAuth,
  pushNotifications,
  mobileSessions,
  offlineQueue,
  mobileSecurity,
  mobileAnalytics,
} from '../mobile/index.js';
import {
  generateRegistrationOptions,
  verifyAndStoreRegistration,
  generateAuthenticationOptions,
  verifyAuthentication,
} from '../mobile/webAuthn.js';
import * as StellarService from '../services/stellar.js';
import { ipKeyGenerator } from 'express-rate-limit';
import { createRateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Throttle offline-queue writes per authenticated mobile user to prevent
// queue-flooding memory exhaustion (issue #1378).
const offlineQueueLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 60,
  message: 'Too many offline queue requests, please try again later.',
  keyGenerator: (req) =>
    req.mobile?.userId ? `mobile:${req.mobile.userId}` : ipKeyGenerator(req.ip),
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

/**
 * Mobile tokens are bound to a Prisma session and the device it was issued
 * to (issue #1381): every request must carry a matching `X-Device-Id`, and
 * the session must still be active — so a web "log out everywhere" also
 * kills mobile tokens immediately.
 */
async function requireMobileAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing token' });

  let payload;
  try {
    payload = mobileAuth.verifyToken(token);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  if (!payload.sid || !payload.deviceId) {
    return res
      .status(401)
      .json({ error: 'Token is not bound to a device session', code: 'SESSION_BINDING_REQUIRED' });
  }
  const deviceId = req.headers['x-device-id'];
  if (!deviceId || deviceId !== payload.deviceId) {
    return res.status(401).json({ error: 'Device mismatch', code: 'SESSION_DEVICE_MISMATCH' });
  }

  try {
    const session = await mobileSessions.validate(payload.sid, deviceId);
    if (!session || session.userId !== payload.userId) {
      return res.status(401).json({ error: 'Session expired or revoked', code: 'SESSION_REVOKED' });
    }
    req.mobile = { ...payload, session };
    next();
  } catch (e) {
    if (e.code === 'SESSION_DEVICE_MISMATCH') {
      return res.status(401).json({ error: e.message, code: e.code });
    }
    res.status(503).json({ error: 'Unable to verify session', code: 'SESSION_CHECK_FAILED' });
  }
}

function deviceInfo(req) {
  return {
    deviceModel: req.headers['x-device-model'],
    osVersion: req.headers['x-os-version'],
    appVersion: req.headers['x-app-version'],
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  };
}

// ─── PIN Auth ─────────────────────────────────────────────────────────────────

/** POST /api/mobile/auth/pin/set */
router.post('/auth/pin/set', requireMobileAuth, (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin || pin.length < 4) return res.status(400).json({ error: 'PIN must be at least 4 digits' });
    res.json(mobileAuth.setPin(req.mobile.userId, pin));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** POST /api/mobile/auth/pin/verify */
router.post('/auth/pin/verify', async (req, res) => {
  try {
    const { userId, deviceId, pin } = req.body;
    res.json(await mobileAuth.verifyPin(userId, deviceId, pin, deviceInfo(req)));
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

// ─── Biometric Auth ───────────────────────────────────────────────────────────

/** POST /api/mobile/auth/biometric/register */
router.post('/auth/biometric/register', (req, res) => {
  try {
    const { userId, deviceId, publicKeyPem } = req.body;
    res.json(mobileAuth.registerBiometric(userId, deviceId, publicKeyPem));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** POST /api/mobile/auth/biometric/challenge */
router.post('/auth/biometric/challenge', (req, res) => {
  try {
    const { userId, deviceId } = req.body;
    res.json(mobileAuth.createChallenge(userId, deviceId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** POST /api/mobile/auth/biometric/verify */
router.post('/auth/biometric/verify', async (req, res) => {
  try {
    const { challengeId, signature } = req.body;
    res.json(await mobileAuth.verifyBiometric(challengeId, signature, deviceInfo(req)));
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

// ─── WebAuthn ─────────────────────────────────────────────────────────────────

// Challenges are bound to a ceremony session id (issue #1379). Clients send
// it back as `sessionId` (or the legacy `challengeId`, which carries the same
// value) together with the response for phase 2.

/**
 * POST /api/mobile/auth/webauthn/register
 * Phase 1 (no credential in body): returns registration options.
 * Phase 2 (credential in body):    verifies and persists credential in DB.
 */
router.post('/auth/webauthn/register', async (req, res) => {
  try {
    const { userId, username, credential, deviceName } = req.body;
    const sessionId = req.body.sessionId ?? req.body.challengeId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    if (!credential) {
      // Phase 1 — return options for navigator.credentials.create()
      return res.json(await generateRegistrationOptions(userId, username, { sessionId }));
    }

    // Phase 2 — store the credential
    const result = await verifyAndStoreRegistration(sessionId, credential, deviceName, { userId });
    res.status(201).json(result);
  } catch (e) {
    res.status(e.status ?? 400).json({ error: e.message, code: e.code });
  }
});

/**
 * POST /api/mobile/auth/webauthn/authenticate
 * Phase 1 (no assertion in body): returns authentication options.
 * Phase 2 (assertion in body):    verifies assertion and returns a
 *                                 device-bound session JWT (X-Device-Id required).
 */
router.post('/auth/webauthn/authenticate', async (req, res) => {
  try {
    const { userId, assertion } = req.body;
    const sessionId = req.body.sessionId ?? req.body.challengeId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    if (!assertion) {
      // Phase 1 — return options for navigator.credentials.get()
      const options = await generateAuthenticationOptions(userId, { sessionId });
      return res.json(options);
    }

    const deviceId = req.headers['x-device-id'];
    if (!deviceId) return res.status(400).json({ error: 'X-Device-Id header is required' });

    // Phase 2 — verify assertion and issue a device-bound JWT
    const result = await verifyAuthentication(sessionId, assertion, {
      userId,
      deviceId,
      device: deviceInfo(req),
    });
    res.json(result);
  } catch (e) {
    res.status(e.status ?? 401).json({ error: e.message, code: e.code });
  }
});

// ─── Push Notifications ───────────────────────────────────────────────────────

/** POST /api/mobile/notifications/register */
router.post('/notifications/register', requireMobileAuth, (req, res) => {
  try {
    const { deviceId, token, platform } = req.body;
    res.json(pushNotifications.registerDevice(req.mobile.userId, deviceId, token, platform));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** DELETE /api/mobile/notifications/register/:deviceId */
router.delete('/notifications/register/:deviceId', requireMobileAuth, (req, res) => {
  res.json(pushNotifications.unregisterDevice(req.mobile.userId, req.params.deviceId));
});

/** POST /api/mobile/notifications/send  (internal / admin use) */
router.post('/notifications/send', requireMobileAuth, async (req, res) => {
  try {
    const { userId, title, body, data } = req.body;
    res.json(await pushNotifications.notify(userId, { title, body, data }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

/** POST /api/mobile/sessions */
router.post('/sessions', requireMobileAuth, async (req, res) => {
  const sessionId = await mobileSessions.create(req.mobile.userId, req.mobile.deviceId, {
    ...deviceInfo(req),
    ...req.body.metadata,
  });
  res.json({ sessionId });
});

/** GET /api/mobile/sessions */
router.get('/sessions', requireMobileAuth, async (req, res) => {
  res.json(await mobileSessions.listForUser(req.mobile.userId));
});

/** DELETE /api/mobile/sessions/:sessionId */
router.delete('/sessions/:sessionId', requireMobileAuth, async (req, res) => {
  // Scoped to the caller's own sessions.
  const revoked = await mobileSessions.revoke(req.params.sessionId, req.mobile.userId);
  if (!revoked) return res.status(404).json({ error: 'Session not found' });
  res.json({ revoked: true });
});

/** DELETE /api/mobile/sessions — global logout (web + mobile) */
router.delete('/sessions', requireMobileAuth, async (req, res) => {
  const count = await mobileSessions.revokeAll(req.mobile.userId);
  res.json({ revoked: count });
});

// ─── Offline Queue ────────────────────────────────────────────────────────────

/** POST /api/mobile/queue  — enqueue a transaction while offline */
router.post('/queue', requireMobileAuth, offlineQueueLimiter, (req, res) => {
  try {
    const item = offlineQueue.enqueue(req.mobile.userId, req.body.transaction);
    res.json(item);
  } catch (e) {
    if (e.code === 'OFFLINE_QUEUE_LIMIT_EXCEEDED') {
      return res.status(429).json({ error: e.message, code: e.code });
    }
    if (e.code === 'OFFLINE_QUEUE_PAYLOAD_TOO_LARGE') {
      return res.status(413).json({ error: e.message, code: e.code });
    }
    res.status(400).json({ error: e.message });
  }
});

/** GET /api/mobile/queue */
router.get('/queue', requireMobileAuth, (req, res) => {
  res.json(offlineQueue.getQueue(req.mobile.userId));
});

/** POST /api/mobile/queue/flush — process pending txs with sequence pre-flight */
// Submitting queued transactions to the network is a high-risk operation:
// require fresh server-verified hardware attestation (issue #1382).
router.post('/queue/flush', requireMobileAuth, mobileSecurity.requireHardwareAttestation(), async (req, res) => {
  try {
    const outcome = await offlineQueue.flushQueue(req.mobile.userId);
    const status = outcome.requiresResign ? 409 : 200;
    res.status(status).json(outcome);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Security ─────────────────────────────────────────────────────────────────

/** POST /api/mobile/security/register */
router.post('/security/register', async (req, res) => {
  try {
    // Client-sent integrity booleans (isJailbroken / isRooted) are deliberately ignored.
    const { deviceId, fingerprint, pinnedCertHash } = req.body;
    res.json(await mobileSecurity.registerDevice(deviceId, fingerprint, pinnedCertHash));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** POST /api/mobile/security/validate */
router.post('/security/validate', async (req, res) => {
  try {
    const { deviceId, fingerprint, certHash } = req.body;
    await mobileSecurity.validateRequest(deviceId, fingerprint, certHash);
    res.json({ valid: true });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});

/**
 * POST /api/mobile/security/attest/challenge
 * Issue a single-use nonce for Play Integrity / App Attest (5 min TTL).
 * Also used before each high-risk operation to obtain a fresh nonce.
 */
router.post('/security/attest/challenge', async (req, res) => {
  try {
    res.json(await mobileSecurity.createAttestationChallenge(req.body.deviceId));
  } catch (e) {
    res.status(e.status ?? 400).json({ error: e.message, code: e.code });
  }
});

/**
 * POST /api/mobile/security/attest
 * Body: { deviceId, platform: 'android', integrityToken }
 *    or { deviceId, platform: 'ios', keyId, attestationObject }
 */
router.post('/security/attest', async (req, res) => {
  try {
    const { deviceId, platform, integrityToken, keyId, attestationObject } = req.body;
    res.json(
      await mobileSecurity.attestDevice(deviceId, { platform, integrityToken, keyId, attestationObject }),
    );
  } catch (e) {
    res.status(e.status ?? 403).json({ error: e.message, code: e.code });
  }
});

/** POST /api/mobile/security/jailbreak — self-report; can only restrict the caller's own device */
router.post('/security/jailbreak', requireMobileAuth, async (req, res) => {
  await mobileSecurity.flagJailbroken(req.mobile.deviceId);
  res.json({ flagged: true });
});

/** GET /api/mobile/security/alerts */
router.get('/security/alerts', requireMobileAuth, async (req, res) => {
  res.json(await mobileSecurity.getAlerts(req.query.deviceId));
});

// ─── Mobile Account Endpoints ─────────────────────────────────────────────────

/** GET /api/mobile/account/:publicKey/balance */
router.get('/account/:publicKey/balance', requireMobileAuth, async (req, res) => {
  try {
    const account = await StellarService.getBalance(req.params.publicKey);
    res.json(account);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

/** GET /api/mobile/account/:publicKey/transactions */
router.get('/account/:publicKey/transactions', requireMobileAuth, async (req, res) => {
  try {
    const { limit = 10, cursor } = req.query;
    const result = await StellarService.getTransactions(req.params.publicKey, { limit: Number(limit), cursor });
    res.json({ publicKey: req.params.publicKey, transactions: result.records, nextCursor: result.nextCursor, hasMore: result.hasMore });
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// ─── Analytics ────────────────────────────────────────────────────────────────

/** POST /api/mobile/analytics/track */
router.post('/analytics/track', requireMobileAuth, (req, res) => {
  try {
    const { event, properties } = req.body;
    res.json(mobileAnalytics.track(req.mobile.userId, req.mobile.deviceId, event, properties));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** GET /api/mobile/analytics/stats */
router.get('/analytics/stats', requireMobileAuth, (req, res) => {
  res.json(mobileAnalytics.getStats(req.mobile.userId));
});

/** GET /api/mobile/analytics/summary */
router.get('/analytics/summary', (req, res) => {
  res.json(mobileAnalytics.getSummary());
});

export default router;
