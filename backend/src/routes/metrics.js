/**
 * Metrics route
 *
 * Note: GET /api/metrics/shards and GET /api/metrics/shards/health were
 * removed in Issue #1126 along with db/sharding.js, which bypassed Prisma
 * via raw pg.Pool and is no longer needed.
 */

import express from 'express';
import { getSnapshot, resetMetrics, toPrometheusText } from '../monitoring/metrics.js';
import { getWsStats } from '../services/websocket.js';
import { getFeeBumpStats } from '../services/stellar.js';
import { getCdnStats } from '../cdn/index.js';
import { getHorizonErrorStats } from '../monitoring/horizonAlerter.js';

const router = express.Router();

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

// DELETE /api/metrics — reset collected metrics
router.delete('/', (_req, res) => {
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

export default router;
