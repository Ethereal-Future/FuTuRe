import express from 'express';
import {
  createBackup,
  verifyBackup,
  restoreBackup,
  listBackups,
  enforceRetention,
  getMetrics,
} from '../backup/manager.js';

const router = express.Router();

// GET  /api/backup          — list all backup files
router.get('/', async (_req, res) => {
  try {
    res.json(await listBackups());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/backup          — trigger a manual backup
router.post('/', async (req, res) => {
  try {
    const meta = await createBackup({ tag: req.body?.tag || 'manual' });
    res.status(201).json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/backup/verify   — verify checksum of a backup file
router.post('/verify', async (req, res) => {
  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'file is required' });
  try {
    res.json(await verifyBackup(file));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/backup/restore  — restore a backup (supports PITR via targetTime)
router.post('/restore', async (req, res) => {
  const { file, targetTime, targetDatabase } = req.body;
  if (!file) return res.status(400).json({ error: 'file is required' });
  try {
    res.json(await restoreBackup(file, { targetTime, targetDatabase }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/backup/retention — enforce retention policy immediately
router.delete('/retention', async (_req, res) => {
  try {
    res.json(await enforceRetention());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET  /api/backup/metrics  — backup health, counters, alerts
router.get('/metrics', (_req, res) => {
  res.json(getMetrics());
});

export default router;
