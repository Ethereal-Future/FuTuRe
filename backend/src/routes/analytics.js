import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { aggregator, userBehavior, fraudDetector, patternAnalyzer, dataExporter } from '../analytics/index.js';

const router = Router();

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/analytics/summary/daily:
 *   get:
 *     summary: Get daily transaction volume and count summary
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Daily summary data
 *       500:
 *         description: Server error
 */
router.get('/summary/daily', async (req, res) => {
  try {
    const { from, to, userId } = req.query;
    res.json(await aggregator.dailySummary({ from, to, userId }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/analytics/summary/totals:
 *   get:
 *     summary: Get overall transaction totals
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Totals data
 *       500:
 *         description: Server error
 */
router.get('/summary/totals', async (req, res) => {
  try {
    const { from, to, userId } = req.query;
    res.json(await aggregator.totals({ from, to, userId }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── User Behaviour ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/analytics/users/{userId}/behaviour:
 *   get:
 *     summary: Get behaviour profile for a user
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: User behaviour profile
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/users/:userId/behaviour', requireAuth, async (req, res) => {
  try {
    res.json(await userBehavior.getProfile(req.params.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pattern Analysis ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/analytics/patterns:
 *   get:
 *     summary: Analyze transaction patterns
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Pattern analysis result
 *       500:
 *         description: Server error
 */
router.get('/patterns', async (req, res) => {
  try {
    const { userId, from, to } = req.query;
    res.json(await patternAnalyzer.analyze({ userId, from, to }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fraud Detection ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/analytics/fraud/flags:
 *   get:
 *     summary: Get fraud detection flags
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Fraud flags
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/fraud/flags', requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const flags = await fraudDetector.analyze({ from, to });
    res.json({ count: flags.length, flags });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard (combined) ──────────────────────────────────────────────────────

/**
 * @swagger
 * /api/analytics/dashboard:
 *   get:
 *     summary: Get combined analytics dashboard data
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Dashboard data (totals, daily, patterns)
 *       500:
 *         description: Server error
 */
router.get('/dashboard', async (req, res) => {
  try {
    const { from, to } = req.query;
    const [totals, daily, patterns] = await Promise.all([
      aggregator.totals({ from, to }),
      aggregator.dailySummary({ from, to }),
      patternAnalyzer.analyze({ from, to }),
    ]);
    res.json({ totals, daily, patterns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/analytics/export:
 *   get:
 *     summary: Export transaction analytics data
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, csv], default: json }
 *     responses:
 *       200:
 *         description: Exported data (JSON or CSV)
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/export', requireAuth, async (req, res) => {
  try {
    const { userId, from, to, format = 'json' } = req.query;
    const result = await dataExporter.export({ userId, from, to, format });
    res.setHeader('Content-Type', result.contentType);
    if (format === 'csv') res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send(result.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
