import express from 'express';
import { getSnapshot, resetMetrics } from '../monitoring/metrics.js';
import { getWsStats } from '../services/websocket.js';
import { getFeeBumpStats } from '../services/stellar.js';
import { getCdnStats } from '../cdn/index.js';
import { checkShardHealth, getShardStats } from '../db/sharding.js';

const router = express.Router();

// GET /api/metrics — full performance snapshot
router.get('/', (_req, res) => {
  res.json(getSnapshot());
});

// DELETE /api/metrics — reset collected metrics
router.delete('/', (_req, res) => {
  resetMetrics();
  res.json({ message: 'Metrics reset' });
});

// GET /api/metrics/websocket — live WebSocket analytics
router.get('/websocket', (_req, res) => {
  res.json(getWsStats());
// GET /api/metrics/fee-bump — fee bump usage stats for cost tracking
router.get('/fee-bump', (_req, res) => {
  res.json(getFeeBumpStats());
// GET /api/metrics/cdn — CDN analytics and config
router.get('/cdn', (_req, res) => {
  res.json(getCdnStats());
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
