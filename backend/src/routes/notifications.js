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

/** GET /api/notifications */
router.get('/', [
  query('unreadOnly').optional().isBoolean().toBoolean(),
], validate, (req, res) => {
  const { unreadOnly = false } = req.query;
  const notifications = getInAppNotifications(req.user.sub, { unreadOnly });
  res.json({ notifications });
});

/** POST /api/notifications/read-all */
router.post('/read-all', (req, res) => {
  const result = markAsRead(req.user.sub, 'all');
  res.json(result);
});

/** POST /api/notifications/:id/read */
router.post('/:id/read', (req, res) => {
  const result = markAsRead(req.user.sub, req.params.id);
  res.json(result);
});

/** GET /api/notifications/preferences */
router.get('/preferences', async (req, res) => {
  try {
    const prefs = await getPreferences(req.user.sub);
    res.json({ preferences: prefs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/notifications/preferences */
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

/** GET /api/notifications/delivery */
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

/** GET /api/notifications/stats */
router.get('/stats', (req, res) => {
  const stats = getDeliveryStats(req.user.sub);
  res.json({ stats });
});

export default router;
