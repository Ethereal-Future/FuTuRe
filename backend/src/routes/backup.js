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

// GET  /api/backup/status   — get last backup info for UI
router.get('/status', async (_req, res) => {
  try {
    const backups = await listBackups();
    const lastBackup = backups.length > 0 ? backups[0] : null;
    const metrics = getMetrics();
    
    res.json({
      lastBackup: lastBackup ? {
        timestamp: lastBackup.createdAt,
        file: lastBackup.file,
        size: lastBackup.size,
      } : null,
      metrics: {
        totalBackups: backups.length,
        totalSize: backups.reduce((sum, b) => sum + b.size, 0),
        ...metrics,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
