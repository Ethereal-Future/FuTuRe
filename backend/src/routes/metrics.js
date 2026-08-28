import express from 'express';
import { getSnapshot, resetMetrics, toPrometheusText } from '../monitoring/metrics.js';
import { getWsStats } from '../services/websocket.js';
import { getFeeBumpStats } from '../services/stellar.js';
import { getCdnStats } from '../cdn/index.js';
import { checkShardHealth, getShardStats } from '../db/sharding.js';
import { getHorizonErrorStats } from '../monitoring/horizonAlerter.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = express.Router();

// GET routes below are intentionally public: they expose only aggregate,
// non-sensitive operational metrics and are scraped by Prometheus /
// load balancers without app-level credentials (#1102).

// GET /api/metrics — full snapshot (Prometheus text if Accept: text/plain, else JSON)
router.get('/', (req, res) => {
  const accept = req.headers['accept'] ?? '';
  if (accept.includes('text/plain') || accept.includes('application/openmetrics-text')) {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return res.send(toPrometheusText());
  }
  const snapshot = getSnapshot();
  snapshot.horizon = getHorizonErrorStats();
  res.json(snapshot);
});

// DELETE /api/metrics — reset collected metrics (destructive, admin-only per #1102)
router.delete('/', requireAdmin, (_req, res) => {
  resetMetrics();
  res.json({ message: 'Metrics reset' });
});

// GET /api/metrics/websocket — live WebSocket analytics
router.get('/websocket', (_req, res) => {
  res.json(getWsStats());
});

// GET /api/metrics/fee-bump — fee bump usage stats for cost tracking
router.get('/fee-bump', (_req, res) => {
  res.json(getFeeBumpStats());
});

// GET /api/metrics/cdn — CDN analytics and config
router.get('/cdn', (_req, res) => {
  res.json(getCdnStats());
});

// GET /api/metrics/shards — shard pool stats
router.get('/shards', (_req, res) => {
  res.json(getShardStats());
});

// GET /api/metrics/shards/health — shard health checks
router.get('/shards/health', async (_req, res) => {
  const health = await checkShardHealth();
  const allOk = health.every(h => h.status === 'ok');
  res.status(allOk ? 200 : 503).json(health);
});

export default router;
