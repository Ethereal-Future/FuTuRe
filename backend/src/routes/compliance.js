import { Router } from 'express';
import prisma from '../db/client.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// GET /api/compliance/aml-alerts (admin only)
router.get('/aml-alerts', authenticateToken, async (req, res) => {
  if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'admin' && !req.user.isAdmin)) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  try {
    const alerts = await prisma.aMLAlert.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(alerts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch AML alerts' });
  }
});

export default router;