import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { aggregator, userBehavior, fraudDetector, patternAnalyzer, dataExporter } from '../analytics/index.js';

const router = Router();

// ── Aggregation ───────────────────────────────────────────────────────────────

// Daily volume + count summary
router.get('/summary/daily', async (req, res) => {
  try {
    const { from, to, userId } = req.query;
    res.json(await aggregator.dailySummary({ from, to, userId }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Overall totals
router.get('/summary/totals', async (req, res) => {
  try {
    const { from, to, userId } = req.query;
    res.json(await aggregator.totals({ from, to, userId }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── User Behaviour ────────────────────────────────────────────────────────────

router.get('/users/:userId/behaviour', requireAuth, async (req, res) => {
  try {
    res.json(await userBehavior.getProfile(req.params.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pattern Analysis ──────────────────────────────────────────────────────────

router.get('/patterns', async (req, res) => {
  try {
    const { userId, from, to } = req.query;
    res.json(await patternAnalyzer.analyze({ userId, from, to }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Fraud Detection ───────────────────────────────────────────────────────────

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
