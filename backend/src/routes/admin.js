import express from 'express';
import { query, validationResult } from 'express-validator';
import prisma from '../db/client.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import { logAdminAction } from '../db/adminAuditLog.js';

const router = express.Router();

// Returns 400 (not the shared 422 `validate` middleware) to match this
// endpoint's documented contract for malformed/reversed date filters.
const validateAuditLogDateRange = [
  query('from').optional().isISO8601().withMessage('from must be a valid ISO 8601 date'),
  query('to').optional().isISO8601().withMessage('to must be a valid ISO 8601 date'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array().map((e) => ({ field: e.path, message: e.msg })) });
    }

    const { from, to } = req.query;
    if (from && to && new Date(from) > new Date(to)) {
      return res.status(400).json({ error: '`from` must not be later than `to`' });
    }

    next();
  },
];

router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [totalUsers, totalTransactions, activeStreams, pendingKYC, openAMLAlerts] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.transaction.count({ where: { deletedAt: null } }),
      prisma.paymentStream.count({ where: { status: 'ACTIVE' } }),
      prisma.kYCRecord.count({ where: { status: 'PENDING' } }),
      prisma.aMLAlert.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } }),
    ]);

    res.json({
      totalUsers,
      totalTransactions,
      activeStreams,
      pendingKYC,
      openAMLAlerts,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve admin stats' });
  }
});

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

router.put('/kyc/:userId/approve', requireAdmin, async (req, res) => {
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

router.put('/kyc/:userId/reject', requireAdmin, async (req, res) => {
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

/**
 * @swagger
 * /api/admin/audit-log:
 *   get:
 *     summary: List admin audit log entries
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO 8601 timestamp — only include entries created at or after this time.
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO 8601 timestamp — only include entries created at or before this time. Must not be earlier than `from`.
 *     responses:
 *       200:
 *         description: Paginated audit log entries
 *       400:
 *         description: Malformed `from`/`to` (not ISO 8601) or `from` later than `to`
 *       500:
 *         description: Server error
 */
router.get('/audit-log', requireAdmin, validateAuditLogDateRange, async (req, res) => {
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