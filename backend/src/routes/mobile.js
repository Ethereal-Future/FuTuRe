import express from 'express';
import {
  mobileAuth,
  pushNotifications,
  mobileSessions,
  offlineQueue,
  mobileSecurity,
  mobileAnalytics,
} from '../mobile/index.js';
import * as StellarService from '../services/stellar.js';

const router = express.Router();

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireMobileAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    req.mobile = mobileAuth.verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
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
router.post('/auth/pin/verify', (req, res) => {
  try {
    const { userId, deviceId, pin } = req.body;
    res.json(mobileAuth.verifyPin(userId, deviceId, pin));
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
router.post('/auth/biometric/verify', (req, res) => {
  try {
    const { challengeId, signature } = req.body;
    res.json(mobileAuth.verifyBiometric(challengeId, signature));
  } catch (e) {
    res.status(401).json({ error: e.message });
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
router.post('/sessions', requireMobileAuth, (req, res) => {
  const sessionId = mobileSessions.create(req.mobile.userId, req.mobile.deviceId, req.body.metadata);
  res.json({ sessionId });
});

/** GET /api/mobile/sessions */
router.get('/sessions', requireMobileAuth, (req, res) => {
  res.json(mobileSessions.listForUser(req.mobile.userId));
});

/** DELETE /api/mobile/sessions/:sessionId */
router.delete('/sessions/:sessionId', requireMobileAuth, (req, res) => {
  mobileSessions.revoke(req.params.sessionId);
  res.json({ revoked: true });
});

/** DELETE /api/mobile/sessions */
router.delete('/sessions', requireMobileAuth, (req, res) => {
  const count = mobileSessions.revokeAll(req.mobile.userId);
  res.json({ revoked: count });
});

// ─── Offline Queue ────────────────────────────────────────────────────────────

/** POST /api/mobile/queue  — enqueue a transaction while offline */
router.post('/queue', requireMobileAuth, (req, res) => {
  try {
    const item = offlineQueue.enqueue(req.mobile.userId, req.body.transaction);
    res.json(item);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** GET /api/mobile/queue */
router.get('/queue', requireMobileAuth, (req, res) => {
  res.json(offlineQueue.getQueue(req.mobile.userId));
});

/** POST /api/mobile/queue/flush — process all pending queued transactions */
router.post('/queue/flush', requireMobileAuth, async (req, res) => {
  const pending = offlineQueue.getQueue(req.mobile.userId).filter(i => i.status === 'pending');
  const results = [];

  for (const item of pending) {
    try {
      const { sourceSecret, destination, amount, assetCode } = item.transaction;
      const result = await StellarService.sendPayment(sourceSecret, destination, amount, assetCode);
      offlineQueue.updateStatus(req.mobile.userId, item.id, 'success', result);
      results.push({ id: item.id, status: 'success', hash: result.hash });
    } catch (e) {
      offlineQueue.updateStatus(req.mobile.userId, item.id, 'failed', { error: e.message });
      results.push({ id: item.id, status: 'failed', error: e.message });
    }
  }

  offlineQueue.clearProcessed(req.mobile.userId);
  res.json({ processed: results.length, results });
});

// ─── Security ─────────────────────────────────────────────────────────────────

/** POST /api/mobile/security/register */
router.post('/security/register', (req, res) => {
  try {
    const { deviceId, fingerprint, pinnedCertHash } = req.body;
    res.json(mobileSecurity.registerDevice(deviceId, fingerprint, pinnedCertHash));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** POST /api/mobile/security/validate */
router.post('/security/validate', (req, res) => {
  try {
    const { deviceId, fingerprint, certHash } = req.body;
    mobileSecurity.validateRequest(deviceId, fingerprint, certHash);
    res.json({ valid: true });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});

/** POST /api/mobile/security/jailbreak */
router.post('/security/jailbreak', (req, res) => {
  mobileSecurity.flagJailbroken(req.body.deviceId);
  res.json({ flagged: true });
});

/** GET /api/mobile/security/alerts */
router.get('/security/alerts', requireMobileAuth, (req, res) => {
  res.json(mobileSecurity.getAlerts(req.query.deviceId));
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
    const txns = await StellarService.getTransactionHistory(req.params.publicKey, { limit: Number(limit), cursor });
    res.json(txns);
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
