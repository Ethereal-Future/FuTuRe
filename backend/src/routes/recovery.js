import express from 'express';
import { body, param, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/auth.js';
import { getUserById } from '../auth/userStore.js';
import {
  addContact, confirmContact, removeContact, getContacts,
  getConfirmedContactCount, initiateRecovery, recordAttempt,
  addApproval, completeRecovery, cancelRecovery, getActiveRequest,
  getRequest, getUserRequests, setupRecoveryPhrase, verifyRecoveryPhrase,
  markPhraseUsed, hasRecoveryPhrase, stageNewCredentials,
  consumePendingCredentials, logRecoveryInitiated, logRecoveryAttempt,
  logRecoveryCompleted, logRecoveryCancelled, logRecoveryLocked,
} from '../recovery/index.js';

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
  next();
};

const ip = (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown';

// ── Recovery Phrase ──────────────────────────────────────────────────────────

// POST /api/recovery/phrase/setup  — generate and store a recovery phrase
router.post('/phrase/setup', requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    if (hasRecoveryPhrase(userId)) {
      return res.status(409).json({ error: 'Recovery phrase already set up. Reset it first.' });
    }
    const phrase = setupRecoveryPhrase(userId);
    // Return phrase ONCE — user must store it securely
    res.status(201).json({
      phrase,
      warning: 'Store this phrase securely. It will not be shown again.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recovery/phrase/status
router.get('/phrase/status', requireAuth, (req, res) => {
  res.json({ configured: hasRecoveryPhrase(req.user.sub) });
});

// ── Recovery Contacts ────────────────────────────────────────────────────────

// GET /api/recovery/contacts
router.get('/contacts', requireAuth, (req, res) => {
  res.json({ contacts: getContacts(req.user.sub) });
});

// POST /api/recovery/contacts
router.post(
  '/contacts',
  requireAuth,
  body('email').isEmail().normalizeEmail(),
  body('name').trim().isLength({ min: 1, max: 64 }),
  validate,
  (req, res) => {
    try {
      const contact = addContact(req.user.sub, req.body.email, req.body.name);
      res.status(201).json({ contact });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// POST /api/recovery/contacts/:contactId/confirm
router.post('/contacts/:contactId/confirm', requireAuth,
  param('contactId').isUUID(), validate,
  (req, res) => {
    try {
      const contact = confirmContact(req.user.sub, req.params.contactId);
      res.json({ contact });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  }
);

// DELETE /api/recovery/contacts/:contactId
router.delete('/contacts/:contactId', requireAuth,
  param('contactId').isUUID(), validate,
  (req, res) => {
    try {
      removeContact(req.user.sub, req.params.contactId);
      res.json({ message: 'Contact removed' });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  }
);

// ── Recovery Workflow ────────────────────────────────────────────────────────

// POST /api/recovery/initiate  — start a recovery request (unauthenticated — user locked out)
router.post(
  '/initiate',
  body('userId').notEmpty(),
  body('method').isIn(['phrase', 'social']),
  validate,
  async (req, res) => {
    try {
      const { userId, method } = req.body;
      if (!getUserById(userId)) return res.status(404).json({ error: 'User not found' });

      const request = initiateRecovery(userId, method, ip(req));
      await logRecoveryInitiated(userId, request.id, method, ip(req));

      res.status(201).json({
        requestId: request.id,
        executeAfter: request.executeAfter,
        expiresAt: request.expiresAt,
        message: `Recovery initiated. A ${24}h time-lock is in effect for security.`,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// POST /api/recovery/:requestId/verify-phrase  — verify recovery phrase
router.post(
  '/:requestId/verify-phrase',
  param('requestId').isUUID(),
  body('phrase').notEmpty(),
  validate,
  async (req, res) => {
    const { requestId } = req.params;
    const request = getRequest(requestId);
    if (!request) return res.status(404).json({ error: 'Recovery request not found' });
    if (request.method !== 'phrase') return res.status(400).json({ error: 'Wrong recovery method' });

    const success = verifyRecoveryPhrase(request.userId, req.body.phrase);
    try {
      const updated = recordAttempt(requestId, success);
      await logRecoveryAttempt(request.userId, requestId, success, ip(req));

      if (!success) return res.status(401).json({ error: 'Invalid recovery phrase', attemptsLeft: 5 - updated.attempts });

      markPhraseUsed(request.userId);
      res.json({ status: updated.status, executeAfter: updated.executeAfter });
    } catch (err) {
      if (err.message.includes('locked')) {
        await logRecoveryLocked(request.userId, requestId, ip(req));
      }
      res.status(400).json({ error: err.message });
    }
  }
);

// POST /api/recovery/:requestId/social-approve  — a contact approves recovery
router.post(
  '/:requestId/social-approve',
  param('requestId').isUUID(),
  body('contactId').isUUID(),
  validate,
  async (req, res) => {
    try {
      const request = getRequest(req.params.requestId);
      if (!request) return res.status(404).json({ error: 'Recovery request not found' });
      if (request.method !== 'social') return res.status(400).json({ error: 'Wrong recovery method' });

      const confirmedCount = getConfirmedContactCount(request.userId);
      const threshold = Math.ceil(confirmedCount / 2) || 1; // majority

      const updated = addApproval(req.params.requestId, req.body.contactId);

      if (updated.approvals.length >= threshold) {
        recordAttempt(req.params.requestId, true);
        await logRecoveryAttempt(request.userId, req.params.requestId, true, ip(req));
      }

      res.json({
        approvals: updated.approvals.length,
        required: threshold,
        status: updated.status,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// POST /api/recovery/:requestId/complete  — finalize recovery after time-lock
router.post(
  '/:requestId/complete',
  param('requestId').isUUID(),
  body('newPassword').isLength({ min: 8 }),
  validate,
  async (req, res) => {
    try {
      const request = completeRecovery(req.params.requestId);
      await stageNewCredentials(request.userId, req.body.newPassword);
      await logRecoveryCompleted(request.userId, req.params.requestId, ip(req));
      res.json({ message: 'Recovery complete. You may now log in with your new password.' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// POST /api/recovery/:requestId/cancel
router.post('/:requestId/cancel', requireAuth,
  param('requestId').isUUID(), validate,
  async (req, res) => {
    try {
      cancelRecovery(req.params.requestId, req.user.sub);
      await logRecoveryCancelled(req.user.sub, req.params.requestId, ip(req));
      res.json({ message: 'Recovery cancelled' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

// GET /api/recovery/status  — get active recovery request for authenticated user
router.get('/status', requireAuth, (req, res) => {
  const active = getActiveRequest(req.user.sub);
  res.json({ active: active || null });
});

// GET /api/recovery/history  — full request history for authenticated user
router.get('/history', requireAuth, (req, res) => {
  res.json({ requests: getUserRequests(req.user.sub) });
});

export default router;
