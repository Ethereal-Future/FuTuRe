/**
 * Notification routes.
 *
 * GET    /api/notifications              - Get in-app notifications
 * POST   /api/notifications/:id/read     - Mark notification as read
 * POST   /api/notifications/read-all     - Mark all as read
 * GET    /api/notifications/preferences  - Get notification preferences
 * PUT    /api/notifications/preferences  - Update notification preferences
 * GET    /api/notifications/delivery     - Get delivery history
 * GET    /api/notifications/stats        - Get delivery stats
 */
import express from 'express';
import { body, query, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/auth.js';
import {
  getInAppNotifications,
  markAsRead,
  getPreferences,
  updatePreferences,
  getDeliveryHistory,
  getDeliveryStats,
} from '../notifications/index.js';

const router = express.Router();

// All notification routes require authentication
router.use(requireAuth);

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
  next();
};

/**
 * @swagger
 * /api/notifications:
 *   get:
 *     summary: Get in-app notifications for authenticated user
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unreadOnly
 *         schema: { type: boolean }
 *         description: Return only unread notifications
 *     responses:
 *       200:
 *         description: List of notifications
 *       401:
 *         description: Unauthorized
 */
router.get('/', [
  query('unreadOnly').optional().isBoolean().toBoolean(),
], validate, (req, res) => {
  const { unreadOnly = false } = req.query;
  const notifications = getInAppNotifications(req.user.sub, { unreadOnly });
  res.json({ notifications });
});

/**
 * @swagger
 * /api/notifications/read-all:
 *   post:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *       401:
 *         description: Unauthorized
 */
router.post('/read-all', (req, res) => {
  const result = markAsRead(req.user.sub, 'all');
  res.json(result);
});

/**
 * @swagger
 * /api/notifications/{id}/read:
 *   post:
 *     summary: Mark a notification as read
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       401:
 *         description: Unauthorized
 */
router.post('/:id/read', (req, res) => {
  const result = markAsRead(req.user.sub, req.params.id);
  res.json(result);
});

/**
 * @swagger
 * /api/notifications/preferences:
 *   get:
 *     summary: Get notification preferences
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notification preferences
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.get('/preferences', async (req, res) => {
  try {
    const prefs = await getPreferences(req.user.sub);
    res.json({ preferences: prefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/notifications/preferences:
 *   put:
 *     summary: Update notification preferences
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               notificationsOn: { type: boolean }
 *               email: { type: boolean }
 *               push: { type: boolean }
 *               sms: { type: boolean }
 *               inApp: { type: boolean }
 *               quietHoursStart: { type: integer, minimum: 0, maximum: 23 }
 *               quietHoursEnd: { type: integer, minimum: 0, maximum: 23 }
 *     responses:
 *       200:
 *         description: Updated preferences
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
router.put('/preferences', [
  body('notificationsOn').optional().isBoolean(),
  body('email').optional().isBoolean(),
  body('push').optional().isBoolean(),
  body('sms').optional().isBoolean(),
  body('inApp').optional().isBoolean(),
  body('quietHoursStart').optional().isInt({ min: 0, max: 23 }),
  body('quietHoursEnd').optional().isInt({ min: 0, max: 23 }),
  body('types').optional().isObject(),
], validate, async (req, res) => {
  try {
    const prefs = await updatePreferences(req.user.sub, req.body);
    res.json({ preferences: prefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/notifications/delivery:
 *   get:
 *     summary: Get notification delivery history
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: channel
 *         schema: { type: string, enum: [email, push, sms, inApp] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, sent, failed, skipped] }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *     responses:
 *       200:
 *         description: Delivery history
 *       401:
 *         description: Unauthorized
 */
router.get('/delivery', [
  query('type').optional().isString(),
  query('channel').optional().isIn(['email', 'push', 'sms', 'inApp']),
  query('status').optional().isIn(['pending', 'sent', 'failed', 'skipped']),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
], validate, (req, res) => {
  const { type, channel, status, limit } = req.query;
  const history = getDeliveryHistory(req.user.sub, { type, channel, status, limit });
  res.json({ history });
});

/**
 * @swagger
 * /api/notifications/stats:
 *   get:
 *     summary: Get notification delivery stats
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Delivery statistics
 *       401:
 *         description: Unauthorized
 */
router.get('/stats', (req, res) => {
  const stats = getDeliveryStats(req.user.sub);
  res.json({ stats });
});

import { saveSubscription, getSubscription } from '../notifications/webPush.js';

/**
 * @swagger
 * /api/notifications/push/subscribe:
 *   post:
 *     summary: Subscribe to web push notifications
 *     tags: [Notifications]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [subscription]
 *             properties:
 *               subscription:
 *                 type: object
 *                 properties:
 *                   endpoint: { type: string, format: uri }
 *               publicKey:
 *                 type: string
 *     responses:
 *       201:
 *         description: Subscribed
 *       401:
 *         description: Unauthorized
 */
router.post('/push/subscribe', [
  body('subscription').isObject(),
  body('subscription.endpoint').isURL(),
  body('publicKey').optional().isString(),
], validate, (req, res) => {
  saveSubscription(req.user.sub, req.body.subscription, req.body.publicKey);
  res.status(201).json({ subscribed: true });
});

/** GET /api/notifications/push/subscription — for testing */
router.get('/push/subscription', (req, res) => {
  res.json({ subscription: getSubscription(req.user.sub) });
});

export default router;
