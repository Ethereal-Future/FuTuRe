import { Router } from 'express';
import { requireAuth as authMiddleware } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { prisma } from '../db/client.js';
import {
  kycCollector,
  identityVerifier,
  amlMonitor,
  riskScorer,
  complianceAudit,
  complianceReporting,
} from '../compliance/index.js';

const router = Router();

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
router.post('/reports', authMiddleware, async (req, res) => {
  try {
    const { type, from, to } = req.body;
    const report = await complianceReporting.generateReport(type || 'AML_SUMMARY', { from, to });
    res.status(201).json(report);
  } catch (err) {
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
router.get('/reports', authMiddleware, async (req, res) => {
  const reports = await complianceReporting.listReports();
  res.json(reports);
});

// ── AML Alerts Dashboard (Admin Only) ────────────────────────────────────────

// List all AML alerts with pagination
router.get('/aml/alerts', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, severity, reviewed } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const where = {};
    if (severity) where.severity = severity;
    
    const alerts = await prisma.aMLAlert.findMany({
      where,
      include: {
        transaction: {
          select: {
            hash: true,
            amount: true,
            assetCode: true,
            createdAt: true,
          },
        },
        user: {
          select: {
            publicKey: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit),
    });
    
    const total = await prisma.aMLAlert.count({ where });
    
    res.json({
      alerts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark alert as reviewed (admin only)
router.patch('/aml/alerts/:id/review', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    
    // For now, we'll log the review action in the audit trail
    // In a production system, you'd add a 'reviewed' field to the AMLAlert model
    await complianceAudit.log('AML_ALERT_REVIEWED', req.user.id, {
      alertId: id,
      reviewedBy: req.user.id,
      notes: notes || '',
      reviewedAt: new Date().toISOString(),
    });
    
    res.json({ success: true, message: 'Alert marked as reviewed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
