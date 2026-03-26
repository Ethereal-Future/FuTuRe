import express from 'express';
import { getSnapshot, resetMetrics } from '../monitoring/metrics.js';

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

export default router;
