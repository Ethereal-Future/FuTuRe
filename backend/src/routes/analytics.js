import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { aggregator, userBehavior, fraudDetector, patternAnalyzer, dataExporter } from '../analytics/index.js';
import prisma from '../db/client.js';

// In-memory store for web vitals (replace with DB/time-series in production)
const webVitalsStore = [];

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

// ── Web Vitals ────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/analytics/web-vitals:
 *   post:
 *     summary: Ingest a Web Vitals metric
 *     tags: [Analytics]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, value, rating]
 *             properties:
 *               name:           { type: string }
 *               value:          { type: number }
 *               rating:         { type: string }
 *               navigationType: { type: string }
 *               url:            { type: string }
 *               timestamp:      { type: number }
 *     responses:
 *       204: { description: Accepted }
 *       400: { description: Invalid payload }
 */
router.post('/web-vitals', (req, res) => {
  const { name, value, rating, navigationType, url, timestamp } = req.body;
  if (!name || value == null || !rating) {
    return res.status(400).json({ error: 'name, value, and rating are required' });
  }
  webVitalsStore.push({
    name,
    value: Number(value),
    rating,
    navigationType: navigationType ?? null,
    url: url ?? null,
    timestamp: timestamp ?? Date.now(),
  });
  res.status(204).end();
});

/**
 * @swagger
 * /api/analytics/web-vitals/dashboard:
 *   get:
 *     summary: p75 LCP, FID/INP, CLS aggregated over time buckets
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: number }
 *         description: Unix ms start
 *       - in: query
 *         name: to
 *         schema: { type: number }
 *         description: Unix ms end
 *     responses:
 *       200: { description: p75 aggregates per metric }
 *       401: { description: Unauthorized }
 */
router.get('/web-vitals/dashboard', requireAuth, (req, res) => {
  const from = req.query.from ? Number(req.query.from) : 0;
  const to   = req.query.to   ? Number(req.query.to)   : Date.now();

  const filtered = webVitalsStore.filter(v => v.timestamp >= from && v.timestamp <= to);

  const p75 = (metricName) => {
    const vals = filtered
      .filter(v => v.name === metricName)
      .map(v => v.value)
      .sort((a, b) => a - b);
    if (!vals.length) return null;
    const idx = Math.ceil(vals.length * 0.75) - 1;
    return vals[idx];
  };

  res.json({
    LCP: p75('LCP'),
    FID: p75('FID'),
    INP: p75('INP'),
    CLS: p75('CLS'),
    FCP: p75('FCP'),
    TTFB: p75('TTFB'),
    sampleCount: filtered.length,
  });
});

// ── Client Error Telemetry (Issue #553) ──────────────────────────────────────

const SENSITIVE_PATTERN = /S[0-9A-Z]{54}|(?:secret|privateKey|password|token)(?=\s*[:=])/gi;

function scrub(text) {
  if (!text) return text;
  return text.replace(SENSITIVE_PATTERN, '[REDACTED]');
}

/**
 * @swagger
 * /api/analytics/client-errors:
 *   post:
 *     summary: Report a client-side error from ErrorBoundary
 *     tags: [Analytics]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:     { type: string }
 *               stack:       { type: string }
 *               componentStack: { type: string }
 *               context:     { type: string }
 *               url:         { type: string }
 *               userId:      { type: string }
 *     responses:
 *       204: { description: Accepted }
 *       400: { description: Invalid payload }
 */
router.post('/client-errors', async (req, res) => {
  const { message, stack, componentStack, context, url, userId } = req.body;
  if (!message) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'message is required' } });

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await prisma.clientError.create({
    data: {
      message: scrub(String(message).slice(0, 1000)),
      stack: scrub(stack?.slice(0, 5000)),
      componentStack: scrub(componentStack?.slice(0, 5000)),
      context: context ? String(context).slice(0, 100) : null,
      url: url ? String(url).slice(0, 500) : null,
      userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
      userId: userId ? String(userId).slice(0, 36) : null,
      expiresAt,
    },
  });
  res.status(204).end();
});

/**
 * @swagger
 * /api/analytics/client-errors/dashboard:
 *   get:
 *     summary: Admin view — client error frequency by context (last 30 days)
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Error frequency grouped by context }
 *       401: { description: Unauthorized }
 */
router.get('/client-errors/dashboard', requireAuth, async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await prisma.clientError.groupBy({
      by: ['context'],
      where: { createdAt: { gte: since } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });
    res.json({ buckets: rows.map((r) => ({ context: r.context, count: r._count.id })) });
  } catch (err) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: err.message } });
  }
});

export default router;
