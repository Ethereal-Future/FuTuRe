import express from 'express';
import prisma from '../db/client.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { logAdminAction } from '../db/adminAuditLog.js';
import { createPerUserRateLimiter } from '../middleware/rateLimiter.js';
import { cacheMiddleware } from '../middleware/cache.js';

const router = express.Router();

/**
 * TTL for the /stats cache entry.
 * 30 seconds gives a dashboard acceptable freshness without hammering the DB
 * on every auto-refresh cycle.
 */
export const ADMIN_STATS_TTL_SECONDS = 30;

/** Stable cache key — stats are global, not per-user or per-tenant. */
const STATS_CACHE_KEY = 'admin:stats';

/**
 * Dedicated per-admin rate limiter for KYC state-mutation routes.
 * 30 requests per 10 minutes, keyed on the authenticated admin's user id.
 * Stricter than the global limiter: a compromised admin token cannot hammer
 * approve/reject at the same rate as a public read endpoint.
 */
const kycActionLimiter = createPerUserRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 30,
  message: 'Too many KYC actions. Please slow down.',
});

/**
 * @swagger
 * /api/v1/admin/stats:
 *   get:
 *     summary: Aggregate dashboard stats (cached 30 s)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Aggregate counts with a generatedAt timestamp
 *         headers:
 *           X-Cache:
 *             schema: { type: string, enum: [HIT, MISS] }
 *             description: Whether the response was served from cache
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalUsers:       { type: integer }
 *                 totalTransactions: { type: integer }
 *                 activeStreams:     { type: integer }
 *                 pendingKYC:       { type: integer }
 *                 openAMLAlerts:    { type: integer }
 *                 generatedAt:
 *                   type: string
 *                   format: date-time
 *                   description: ISO timestamp of when the stats were last computed
 *       500:
 *         description: Internal server error
 */
router.get(
  '/stats',
  requireAdmin,
  cacheMiddleware(ADMIN_STATS_TTL_SECONDS, () => STATS_CACHE_KEY),
  async (req, res) => {
    try {
      const [totalUsers, totalTransactions, activeStreams, pendingKYC, openAMLAlerts] =
        await Promise.all([
          prisma.user.count({ where: { deletedAt: null } }),
          prisma.transaction.count({ where: { deletedAt: null } }),
          prisma.paymentStream.count({ where: { status: 'ACTIVE' } }),
          prisma.kYCRecord.count({ where: { status: 'PENDING' } }),
          prisma.aMLAlert.count({
            where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          }),
        ]);

      res.json({
        totalUsers,
        totalTransactions,
        activeStreams,
        pendingKYC,
        openAMLAlerts,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to retrieve admin stats' });
    }
  },
);

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const where = search ? {
      OR: [
        { publicKey: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ],
    } : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        select: {
          id: true,
          publicKey: true,
          username: true,
          role: true,
          createdAt: true,
          kycRecord: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

/**
 * @swagger
 * /api/v1/admin/kyc/{userId}/approve:
 *   put:
 *     summary: Approve a KYC record (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: KYC approved
 *       429:
 *         description: Per-admin rate limit exceeded (30 req/10 min)
 *       500:
 *         description: Internal server error
 */
router.put('/kyc/:userId/approve', requireAdmin, kycActionLimiter, async (req, res) => {
  try {
    const { userId } = req.params;
    const kyc = await prisma.kYCRecord.update({
      where: { userId },
      data: { status: 'APPROVED', updatedAt: new Date() },
    });
    logAdminAction(req.user.sub, 'KYC_APPROVE', 'USER', userId, {}, req);
    res.json({ success: true, kyc });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve KYC' });
  }
});

/**
 * @swagger
 * /api/v1/admin/kyc/{userId}/reject:
 *   put:
 *     summary: Reject a KYC record (admin only)
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: KYC rejected
 *       429:
 *         description: Per-admin rate limit exceeded (30 req/10 min)
 *       500:
 *         description: Internal server error
 */
router.put('/kyc/:userId/reject', requireAdmin, kycActionLimiter, async (req, res) => {
  try {
    const { userId } = req.params;
    const kyc = await prisma.kYCRecord.update({
      where: { userId },
      data: { status: 'REJECTED', updatedAt: new Date() },
    });
    logAdminAction(req.user.sub, 'KYC_REJECT', 'USER', userId, {}, req);
    res.json({ success: true, kyc });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject KYC' });
  }
});

router.get('/audit-log', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, adminUserId, actionType, from, to } = req.query;
    const take = Math.min(parseInt(limit), 200);
    const skip = (parseInt(page) - 1) * take;

    const where = {};
    if (adminUserId) where.adminUserId = adminUserId;
    if (actionType) where.actionType = actionType;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [logs, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.adminAuditLog.count({ where }),
    ]);

    res.json({
      logs,
      pagination: { page: parseInt(page), limit: take, total, pages: Math.ceil(total / take) },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve audit log' });
  }
});

export default router;