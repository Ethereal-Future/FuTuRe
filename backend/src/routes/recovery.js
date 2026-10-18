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
  logRecoveryCompleted, logRecoveryCancelled, logRecoveryLocked, RecoveryAuthError,
} from '../recovery/index.js';

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
  next();
};

const ip = (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown';

// ── Recovery Phrase ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/recovery/phrase/setup:
 *   post:
 *     summary: Generate and store a recovery phrase (shown once)
 *     tags: [Recovery]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Recovery phrase generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 phrase: { type: string }
 *                 warning: { type: string }
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Phrase already configured
 *       500:
 *         description: Server error
 */
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

/**
 * @swagger
 * /api/recovery/phrase/status:
 *   get:
 *     summary: Check if a recovery phrase is configured
 *     tags: [Recovery]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Phrase configuration status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 configured: { type: boolean }
 *       401:
 *         description: Unauthorized
 */
router.get('/phrase/status', requireAuth, (req, res) => {
  res.json({ configured: hasRecoveryPhrase(req.user.sub) });
});

/**
 * @swagger
 * /api/recovery/phrase/confirm-backup:
 *   post:
 *     summary: Confirm recovery phrase backup
 *     description: Mark recovery phrase as backed up and confirmed after user verifies random words
 *     tags: [Recovery]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Backup confirmed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No recovery phrase found
 *       500:
 *         description: Server error
 */
router.post('/phrase/confirm-backup', requireAuth, async (req, res) => {
  try {
    const userId = req.user.sub;
    if (!hasRecoveryPhrase(userId)) {
      return res.status(404).json({ error: 'No recovery phrase found. Generate one first.' });
    }
    // Mark phrase as confirmed/backed up in user settings
    await markPhraseUsed(userId);
    res.json({ message: 'Recovery phrase backup confirmed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Recovery Contacts ────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/recovery/contacts:
 *   get:
 *     summary: List recovery contacts
 *     tags: [Recovery]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Recovery contacts
 *       401:
 *         description: Unauthorized
 */
router.get('/contacts', requireAuth, (req, res) => {
  res.json({ contacts: getContacts(req.user.sub) });
});

/**
 * @swagger
 * /api/recovery/contacts:
 *   post:
 *     summary: Add a recovery contact
 *     tags: [Recovery]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, name]
 *             properties:
 *               email: { type: string, format: email }
 *               name: { type: string, maxLength: 64 }
 *     responses:
 *       201:
 *         description: Contact added
 *       400:
 *         description: Invalid data or limit reached
 *       401:
 *         description: Unauthorized
 */
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

/**
 * @swagger
 * /api/recovery/contacts/{contactId}/confirm:
 *   post:
 *     summary: Confirm a recovery contact
 *     tags: [Recovery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Contact confirmed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Contact not found
 */
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

/**
 * @swagger
 * /api/recovery/contacts/{contactId}:
 *   delete:
 *     summary: Remove a recovery contact
 *     tags: [Recovery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Contact removed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Contact not found
 */
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

/**
 * @swagger
 * /api/recovery/initiate:
 *   post:
 *     summary: Initiate account recovery (unauthenticated)
 *     tags: [Recovery]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, method]
 *             properties:
 *               userId: { type: string }
 *               method: { type: string, enum: [phrase, social] }
 *               newPublicKey:
 *                 type: string
 *                 description: Client-generated Stellar public key that replaces the lost key on completion
 *     responses:
 *       201:
 *         description: Recovery initiated with 24h time-lock
 *       400:
 *         description: Invalid request
 *       404:
 *         description: User not found
 */
router.post(
  '/initiate',
  body('userId').notEmpty(),
  body('method').isIn(['phrase', 'social']),
  body('newPublicKey').optional().trim().matches(STELLAR_PUBLIC_KEY),
  validate,
  async (req, res) => {
    try {
      const { userId, method, newPublicKey } = req.body;
      if (!(await getUserById(userId))) return res.status(404).json({ error: 'User not found' });

      const request = await initiateRecovery(userId, method, ip(req), { newPublicKey });
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

/**
 * @swagger
 * /api/recovery/{requestId}/verify-phrase:
 *   post:
 *     summary: Verify recovery phrase for a recovery request
 *     tags: [Recovery]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phrase]
 *             properties:
 *               phrase: { type: string }
 *     responses:
 *       200:
 *         description: Phrase verified
 *       400:
 *         description: Wrong method or request locked
 *       401:
 *         description: Invalid phrase
 *       404:
 *         description: Request not found
 */
router.post(
  '/:requestId/verify-phrase',
  param('requestId').isUUID(),
  body('phrase').notEmpty(),
  validate,
  async (req, res) => {
    const { requestId } = req.params;
    const request = await getRequest(requestId);
    if (!request) return res.status(404).json({ error: 'Recovery request not found' });
    if (request.method !== 'phrase') return res.status(400).json({ error: 'Wrong recovery method' });

    const success = verifyRecoveryPhrase(request.userId, req.body.phrase);
    try {
      const updated = await recordAttempt(requestId, success);
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

/**
 * @swagger
 * /api/recovery/{requestId}/approve:
 *   post:
 *     summary: A recovery contact approves a social recovery request
 *     description: >
 *       The contact must present the out-of-band approval token emailed to them
 *       when recovery was initiated. Also served at /{requestId}/social-approve.
 *     tags: [Recovery]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contactId, approvalToken]
 *             properties:
 *               contactId: { type: string, format: uuid }
 *               approvalToken: { type: string, description: 64-char hex token }
 *     responses:
 *       200:
 *         description: Approval recorded
 *       400:
 *         description: Wrong method or invalid request
 *       401:
 *         description: Missing or invalid approval token
 *       404:
 *         description: Request not found
 */
router.post(
  ['/:requestId/approve', '/:requestId/social-approve'],
  param('requestId').isUUID(),
  body('contactId').isUUID(),
  validate,
  async (req, res) => {
    try {
      const request = await getRequest(req.params.requestId);
      if (!request) return res.status(404).json({ error: 'Recovery request not found' });
      if (request.method !== 'social') return res.status(400).json({ error: 'Wrong recovery method' });

      const confirmedCount = getConfirmedContactCount(request.userId);
      const threshold = Math.ceil(confirmedCount / 2) || 1; // majority

      let updated = await addApproval(
        req.params.requestId,
        req.body.contactId,
        req.body.approvalToken,
      );

      if (updated.approvals.length >= threshold) {
        updated = await recordAttempt(req.params.requestId, true);
        await logRecoveryAttempt(request.userId, req.params.requestId, true, ip(req));
      }

      res.json({
        approvals: updated.approvals.length,
        required: threshold,
        status: updated.status,
      });
    } catch (err) {
      if (err instanceof RecoveryAuthError) return res.status(401).json({ error: err.message });
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * @swagger
 * /api/recovery/{requestId}/complete:
 *   post:
 *     summary: Complete recovery and set new password (after time-lock)
 *     tags: [Recovery]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [newPassword]
 *             properties:
 *               newPassword: { type: string, minLength: 8 }
 *               newPublicKey:
 *                 type: string
 *                 description: Must match the key supplied at initiation, if any
 *     responses:
 *       200:
 *         description: Recovery complete; signers rotated on-chain and all sessions revoked
 *       400:
 *         description: Time-lock not elapsed or request invalid
 */
router.post(
  '/:requestId/complete',
  param('requestId').isUUID(),
  body('newPassword').isLength({ min: 8 }),
  body('newPublicKey').optional().trim().matches(STELLAR_PUBLIC_KEY),
  validate,
  async (req, res) => {
    try {
      const request = await completeRecovery(req.params.requestId, {
        newPublicKey: req.body.newPublicKey,
      });
      await stageNewCredentials(request.userId, req.body.newPassword);
      await logRecoveryCompleted(request.userId, req.params.requestId, ip(req));
      res.json({
        message: 'Recovery complete. You may now log in with your new password.',
        publicKey: request.newPublicKey,
        rotationTxHash: request.rotationTxHash,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * @swagger
 * /api/recovery/{requestId}/cancel:
 *   post:
 *     summary: Cancel an active recovery request
 *     tags: [Recovery]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Recovery cancelled
 *       400:
 *         description: Cannot cancel
 *       401:
 *         description: Unauthorized
 */
router.post('/:requestId/cancel', requireAuth,
  param('requestId').isUUID(), validate,
  async (req, res) => {
    try {
      await cancelRecovery(req.params.requestId, req.user.sub);
      await logRecoveryCancelled(req.user.sub, req.params.requestId, ip(req));
      res.json({ message: 'Recovery cancelled' });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
);

/**
 * @swagger
 * /api/recovery/status:
 *   get:
 *     summary: Get active recovery request for authenticated user
 *     tags: [Recovery]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active recovery request or null
 *       401:
 *         description: Unauthorized
 */
router.get('/status', requireAuth, async (req, res) => {
  try {
    const active = await getActiveRequest(req.user.sub);
    res.json({ active: active || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/recovery/history:
 *   get:
 *     summary: Get recovery request history for authenticated user
 *     tags: [Recovery]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Recovery request history
 *       401:
 *         description: Unauthorized
 */
router.get('/history', requireAuth, async (req, res) => {
  try {
    res.json({ requests: await getUserRequests(req.user.sub) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
