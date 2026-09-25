import { Router } from 'express';
import { requireAuth as authMiddleware } from '../middleware/auth.js';
import { requireAdmin, requireRole } from '../middleware/adminAuth.js';
import prisma, { RequestAbortedError } from '../db/client.js';
import {
  kycCollector,
  identityVerifier,
  amlMonitor,
  riskScorer,
  complianceAudit,
  complianceReporting,
} from '../compliance/index.js';

const router = Router();

// ── Maker-Checker (Dual Authorization) ────────────────────────────────────────
//
// High-impact compliance decisions (KYC approve/reject, account unfreeze,
// sanctions override, AML alert dismissal) must not be executed by a single
// officer. The first officer (Maker) submits a ComplianceApprovalRequest in
// PENDING_REVIEW; a DIFFERENT authorized officer (Checker) must approve it
// before the underlying action is executed. This enforces the Four-Eyes
// Principle required by FATF Recommendation 18.

const MAKER_CHECKER_ACTIONS = new Set([
  'KYC_APPROVE',
  'KYC_REJECT',
  'ACCOUNT_UNFREEZE',
  'SANCTIONS_OVERRIDE',
  'AML_ALERT_DISMISS',
]);

// Actions that always require explicit dual sign-off regardless of AML score.
const HIGH_RISK_ACTIONS = new Set(['SANCTIONS_OVERRIDE', 'ACCOUNT_UNFREEZE']);

// AML score above which an unfreeze is treated as high-risk and requires
// explicit dual sign-off.
const HIGH_RISK_AML_SCORE = 80;

function isHighRiskAction(action, payload = {}) {
  if (HIGH_RISK_ACTIONS.has(action)) return true;
  if (action === 'ACCOUNT_UNFREEZE' && Number(payload.amlScore) > HIGH_RISK_AML_SCORE) {
    return true;
  }
  return false;
}

/**
 * Submit a maker-checker approval request. The underlying action is NOT
 * executed here — it is deferred until a distinct checker approves it.
 */
async function submitApprovalRequest({ action, targetUserId, makerId, payload = {} }) {
  if (!MAKER_CHECKER_ACTIONS.has(action)) {
    throw new Error(`Action ${action} does not require maker-checker approval`);
  }
  const request = await prisma.complianceApprovalRequest.create({
    data: {
      action,
      targetUserId,
      makerId,
      checkerId: null,
      status: 'PENDING_REVIEW',
      payload,
      highRisk: isHighRiskAction(action, payload),
    },
  });
  await complianceAudit.log('COMPLIANCE_APPROVAL_REQUESTED', makerId, {
    requestId: request.id,
    action,
    targetUserId,
    highRisk: request.highRisk,
  });
  return request;
}

/**
 * Execute the deferred action once a distinct checker has authorized it.
 * Kept intentionally small: routes the approved request to the underlying
 * compliance service.
 */
async function executeApprovedAction(request) {
  const { action, targetUserId, payload } = request;
  switch (action) {
    case 'KYC_APPROVE':
      return kycCollector.updateKycStatus(targetUserId, 'approved');
    case 'KYC_REJECT':
      return kycCollector.updateKycStatus(targetUserId, 'rejected');
    case 'ACCOUNT_UNFREEZE':
      return kycCollector.unfreezeAccount(targetUserId, payload);
    case 'SANCTIONS_OVERRIDE':
      return amlMonitor.overrideSanctions(targetUserId, payload);
    case 'AML_ALERT_DISMISS':
      return amlMonitor.dismissAlert(targetUserId, payload);
    default:
      throw new Error(`Unsupported approval action: ${action}`);
  }
}

// ── KYC ──────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/compliance/kyc:
 *   post:
 *     summary: Submit KYC data
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName: { type: string }
 *               dateOfBirth: { type: string, format: date }
 *               nationality: { type: string }
 *               documentType: { type: string }
 *               documentNumber: { type: string }
 *     responses:
 *       201:
 *         description: KYC record created
 *       400:
 *         description: Invalid data
 *       401:
 *         description: Unauthorized
 */
router.post('/kyc', authMiddleware, async (req, res) => {
  try {
    const record = await kycCollector.submitKYC(req.user.id, req.body);
    await complianceAudit.log('KYC_SUBMITTED', req.user.id, { status: record.status });
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/compliance/kyc/status:
 *   get:
 *     summary: Get KYC status for authenticated user
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: KYC status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, enum: [pending, approved, rejected] }
 *                 submittedAt: { type: string, format: date-time }
 *                 updatedAt: { type: string, format: date-time }
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: No KYC record found
 */
router.get('/kyc/status', authMiddleware, async (req, res) => {
  const record = await kycCollector.getKYCRecord(req.user.id);
  if (!record) return res.status(404).json({ error: 'No KYC record found' });
  res.json({ status: record.status, submittedAt: record.submittedAt, updatedAt: record.updatedAt });
});

/**
 * @swagger
 * /api/compliance/kyc/verify:
 *   post:
 *     summary: Trigger identity verification
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Verification result
 *       400:
 *         description: Verification failed
 *       401:
 *         description: Unauthorized
 */
router.post('/kyc/verify', authMiddleware, async (req, res) => {
  try {
    const result = await identityVerifier.verify(req.user.id);
    await complianceAudit.log('KYC_VERIFICATION', req.user.id, result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Maker-Checker Approval Queue ──────────────────────────────────────────────

/**
 * @swagger
 * /api/compliance/approvals:
 *   post:
 *     summary: Submit a high-impact compliance action for dual authorization (Maker step)
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action, targetUserId]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [KYC_APPROVE, KYC_REJECT, ACCOUNT_UNFREEZE, SANCTIONS_OVERRIDE, AML_ALERT_DISMISS]
 *               targetUserId: { type: string }
 *               payload: { type: object }
 *     responses:
 *       201:
 *         description: Approval request created in PENDING_REVIEW
 *       400:
 *         description: Invalid action or payload
 *       401:
 *         description: Unauthorized
 */
router.post('/approvals', requireRole('COMPLIANCE', 'ADMIN'), async (req, res) => {
  try {
    const { action, targetUserId, payload } = req.body;
    if (!action || !targetUserId) {
      return res.status(400).json({ error: 'action and targetUserId are required' });
    }
    const request = await submitApprovalRequest({
      action,
      targetUserId,
      makerId: req.user.id,
      payload: payload || {},
    });
    res.status(201).json(request);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/compliance/approvals/pending:
 *   get:
 *     summary: List compliance approval requests awaiting a checker
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending approval requests
 *       401:
 *         description: Unauthorized
 */
router.get('/approvals/pending', requireRole('COMPLIANCE', 'ADMIN'), async (req, res) => {
  const pending = await prisma.complianceApprovalRequest.findMany({
    where: { status: 'PENDING_REVIEW' },
    orderBy: { createdAt: 'asc' },
  });
  res.json(pending);
});

/**
 * @swagger
 * /api/compliance/approvals/{id}/approve:
 *   post:
 *     summary: Approve a pending request (Checker step) and execute the deferred action
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Request approved and action executed
 *       400:
 *         description: Request not pending or self-approval attempted
 *       403:
 *         description: Maker and checker must be distinct officers
 *       404:
 *         description: Approval request not found
 */
router.post('/approvals/:id/approve', requireRole('COMPLIANCE', 'ADMIN'), async (req, res) => {
  const { id } = req.params;
  const checkerId = req.user.id;

  const request = await prisma.complianceApprovalRequest.findUnique({ where: { id } });
  if (!request) return res.status(404).json({ error: 'Approval request not found' });
  if (request.status !== 'PENDING_REVIEW') {
    return res.status(400).json({ error: `Request is not pending (status: ${request.status})` });
  }

  // Four-Eyes Principle: the checker must be a different officer than the maker.
  if (request.makerId === checkerId) {
    return res.status(403).json({
      error: 'Maker and checker must be distinct officers; self-approval is not permitted',
    });
  }

  try {
    const result = await executeApprovedAction(request);
    const updated = await prisma.complianceApprovalRequest.update({
      where: { id },
      data: { checkerId, status: 'APPROVED', decidedAt: new Date() },
    });
    await complianceAudit.log('COMPLIANCE_APPROVAL_APPROVED', checkerId, {
      requestId: id,
      action: request.action,
      targetUserId: request.targetUserId,
      makerId: request.makerId,
      checkerId,
    });
    res.json({ success: true, request: updated, result });
  } catch (err) {
    if (err instanceof RequestAbortedError) return;
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/compliance/approvals/{id}/reject:
 *   post:
 *     summary: Reject a pending request (Checker step); the deferred action is not executed
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Request rejected
 *       400:
 *         description: Request not pending
 *       403:
 *         description: Maker and checker must be distinct officers
 *       404:
 *         description: Approval request not found
 */
router.post('/approvals/:id/reject', requireRole('COMPLIANCE', 'ADMIN'), async (req, res) => {
  const { id } = req.params;
  const checkerId = req.user.id;

  const request = await prisma.complianceApprovalRequest.findUnique({ where: { id } });
  if (!request) return res.status(404).json({ error: 'Approval request not found' });
  if (request.status !== 'PENDING_REVIEW') {
    return res.status(400).json({ error: `Request is not pending (status: ${request.status})` });
  }
  if (request.makerId === checkerId) {
    return res.status(403).json({
      error: 'Maker and checker must be distinct officers; self-review is not permitted',
    });
  }

  const updated = await prisma.complianceApprovalRequest.update({
    where: { id },
    data: { checkerId, status: 'REJECTED', decidedAt: new Date() },
  });
  await complianceAudit.log('COMPLIANCE_APPROVAL_REJECTED', checkerId, {
    requestId: id,
    action: request.action,
    targetUserId: request.targetUserId,
    makerId: request.makerId,
    checkerId,
  });
  res.json({ success: true, request: updated });
});

// ── AML ───────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/compliance/aml/screen:
 *   post:
 *     summary: Screen a transaction for AML flags
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transaction]
 *             properties:
 *               transaction:
 *                 type: object
 *                 description: Transaction object to screen
 *               history:
 *                 type: array
 *                 items: { type: object }
 *     responses:
 *       200:
 *         description: AML screening result
 *       400:
 *         description: transaction is required
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/aml/screen', authMiddleware, async (req, res) => {
  try {
    const { transaction, history } = req.body;
    if (!transaction) return res.status(400).json({ error: 'transaction is required' });
    const result = await amlMonitor.screenTransaction(transaction, history || []);
    res.json(result);
  } catch (err) {
    // Client disconnected — DB work was halted/rolled back; nobody to respond to.
    if (err instanceof RequestAbortedError) return;
    res.status(500).json({ error: err.message });
  }
});

// ── Risk Scoring ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/compliance/risk/user:
 *   get:
 *     summary: Get risk score for authenticated user
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Risk score result
 *       401:
 *         description: Unauthorized
 */
router.get('/risk/user', authMiddleware, async (req, res) => {
  const result = await riskScorer.scoreUser(req.user.id);
  res.json(result);
});

// ── Audit Trail ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/compliance/audit:
 *   get:
 *     summary: Get compliance audit trail
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: eventType
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Audit trail entries
 *       401:
 *         description: Unauthorized
 */
router.get('/audit', authMiddleware, async (req, res) => {
  const { from, to, eventType } = req.query;
  const trail = await complianceAudit.getTrail({ userId: req.user.id, from, to, eventType });
  res.json(trail);
});

// ── Reports ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/compliance/reports:
 *   post:
 *     summary: Generate a compliance report
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type: { type: string, default: AML_SUMMARY }
 *               from: { type: string, format: date-time }
 *               to: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Report generated
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.post('/reports', requireRole('COMPLIANCE', 'ADMIN'), async (req, res) => {
  try {
    const { type, from, to } = req.body;
    const report = await complianceReporting.generateReport(type || 'AML_SUMMARY', {
      from,
      to,
      generatedBy: req.user.id,
    });
    res.status(201).json(report);
  } catch (err) {
    // Client disconnected — DB work was halted/rolled back; nobody to respond to.
    if (err instanceof RequestAbortedError) return;
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/compliance/reports:
 *   get:
 *     summary: List compliance reports
 *     tags: [Compliance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of reports
 *       401:
 *         description: Unauthorized
 */
router.get('/reports', requireRole('COMPLIANCE', 'ADMIN'), async (req, res) => {
  const reports = await complianceReporting.listReports();
  res.json(reports);
});

// ── Regulatory Reports (Admin Only) ───────────────────────────────────────

/* … truncated 7429 chars — edit only what you need near the top … */
