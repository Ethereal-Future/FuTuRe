import express from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { cleanupStaleNotifications } from './service.js';

const router = express.Router();

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// GET /api/notifications
// Keyset pagination: pass ?cursor=<notificationId>&limit=<n>
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const parsedLimit = Number.parseInt(req.query.limit, 10);
    const take = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    const cursor = typeof req.query.cursor === 'string' && req.query.cursor.length > 0
      ? { id: req.query.cursor }
      : undefined;

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });

    const hasMore = notifications.length > take;
    const page = hasMore ? notifications.slice(0, take) : notifications;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    res.json({
      notifications: page,
      nextCursor,
      hasMore,
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const notification = await prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { read: true },
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/cleanup
// Manually trigger the retention cleanup (also runs on the daily scheduler).
router.post('/cleanup', requireAuth, async (req, res, next) => {
  try {
    const result = await cleanupStaleNotifications();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
