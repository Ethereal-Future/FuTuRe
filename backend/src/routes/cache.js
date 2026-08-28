import express from 'express';
import { analytics, monitor, cache, warmer, redisBackend } from '../cache/appCache.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = express.Router();

// Cache internals expose key names/hit-rate data and let callers flush the
// whole cache, so this router is admin-only (#1102).
router.use(requireAdmin);

// GET /api/cache/metrics — hit/miss stats, performance, top keys
router.get('/metrics', (_req, res) => {
  res.json({
    analytics: analytics.getMetrics(),
    topKeys: analytics.getTopKeys(10),
    performance: monitor.getPerformanceStats(),
    alerts: monitor.getAlerts().slice(-20),
    cacheSize: cache.getStats(),
    redis: { available: redisBackend.isAvailable() },
  });
});

// DELETE /api/cache — flush entire cache
router.delete('/', async (_req, res) => {
  await cache.clear();
  res.json({ status: 'cleared' });
});

// POST /api/cache/warm — trigger cache warming
router.post('/warm', async (_req, res) => {
  const results = await warmer.warmAll();
  res.json({ results });
});

export default router;
