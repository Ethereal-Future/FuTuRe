import express from 'express';
import {
  eventMonitor,
  eventStore,
  eventReplayer,
  projectionManager,
  eventArchiver,
  eventAnalytics
} from '../eventSourcing/index.js';
import { clampLimit } from '../eventSourcing/eventStore.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = express.Router();

// Event-sourcing internals (replay, projections, archival) are an
// engineering/ops surface, not user-facing, so they are admin-only (#1102).
router.use(requireAdmin);
import { requireAuth, requireAdmin, requireOwnAccount } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);

/**
 * @swagger
 * /api/events/history/{aggregateId}:
 *   get:
 *     summary: Get a page of event history for an aggregate
 *     summary: Get event history for an aggregate
 *     description: "Known limitation: event-sourcing state is in-memory, so it is not durable across deploys or shared across instances. See docs/guides/internal-tooling.md#event-sourcing"
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: aggregateId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 1000
 *       - in: query
 *         name: cursor
 *         description: nextCursor from the previous page
 *         schema:
 *           type: string
 *       - in: query
 *         name: fromVersion
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Event history page retrieved
 */
router.get('/history/:aggregateId', requireOwnAccount('aggregateId'), async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;
    const fromVersion = parseInt(req.query.fromVersion) || 0;
    const { events, nextCursor } = await eventMonitor.getEventHistory(req.params.aggregateId, {
      limit,
      cursor,
      fromVersion,
    });
    res.json({ aggregateId: req.params.aggregateId, events, limit, nextCursor });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/events/state/{aggregateId}:
 *   get:
 *     summary: Get current state of an aggregate
 *     description: "Known limitation: event-sourcing state is in-memory, so it is not durable across deploys or shared across instances. See docs/guides/internal-tooling.md#event-sourcing"
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: aggregateId
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/state/:aggregateId', requireOwnAccount('aggregateId'), async (req, res) => {
  try {
    const state = await eventMonitor.getAggregateState(req.params.aggregateId);
    res.json({ aggregateId: req.params.aggregateId, state });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/events/replay/{aggregateId}:
 *   get:
 *     summary: Replay events to a specific version
 *     description: "Known limitation: event-sourcing state is in-memory, so it is not durable across deploys or shared across instances. See docs/guides/internal-tooling.md#event-sourcing"
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: aggregateId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: toVersion
 *         schema:
 *           type: integer
 */
router.get('/replay/:aggregateId', requireOwnAccount('aggregateId'), async (req, res) => {
  try {
    const toVersion = req.query.toVersion ? parseInt(req.query.toVersion) : null;
    const state = await eventReplayer.replay(req.params.aggregateId, toVersion);
    res.json({ aggregateId: req.params.aggregateId, state });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/events/projection/{name}:
 *   get:
 *     summary: Get a projection
 *     description: "Known limitation: event-sourcing state is in-memory, so it is not durable across deploys or shared across instances. See docs/guides/internal-tooling.md#event-sourcing"
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/projection/:name', requireAdmin, async (req, res) => {
  try {
    const projection = await eventMonitor.getProjection(req.params.name);
    res.json({ name: req.params.name, projection });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/events/analytics/{eventType}:
 *   get:
 *     summary: Get analytics for an event type
 *     description: "Known limitation: event-sourcing state is in-memory, so it is not durable across deploys or shared across instances. See docs/guides/internal-tooling.md#event-sourcing"
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: eventType
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/analytics/:eventType', requireAdmin, async (req, res) => {
  try {
    const analytics = await eventMonitor.getAnalytics(req.params.eventType);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/events/stats:
 *   get:
 *     summary: Get event statistics
 *     description: "Known limitation: event-sourcing state is in-memory, so it is not durable across deploys or shared across instances. See docs/guides/internal-tooling.md#event-sourcing"
 *     tags: [Events]
 */
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await eventMonitor.getEventStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/events/archive:
 *   post:
 *     summary: Archive old events
 *     description: "Known limitation: event-sourcing state is in-memory, so it is not durable across deploys or shared across instances. See docs/guides/internal-tooling.md#event-sourcing"
 *     tags: [Events]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               olderThanDays:
 *                 type: integer
 *                 default: 30
 */
router.post('/archive', requireAdmin, async (req, res) => {
  try {
    const { olderThanDays = 30 } = req.body;
    const result = await eventArchiver.archiveOldEvents(olderThanDays);
    res.json({ archived: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/events/all:
 *   get:
 *     summary: Get all events with pagination
 *     description: "Known limitation: event-sourcing state is in-memory, so it is not durable across deploys or shared across instances. See docs/guides/internal-tooling.md#event-sourcing"
 *     tags: [Events]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 1000
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 */
router.get('/all', requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 1000;
    const offset = parseInt(req.query.offset) || 0;
    const events = await eventStore.getAllEvents(limit, offset);
    res.json({ events, limit, offset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/events/poison-pills:
 *   get:
 *     summary: List events quarantined by the projection pipeline (admin)
 *     tags: [Events]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [QUARANTINED, RESOLVED]
 *           default: QUARANTINED
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 */
router.get('/poison-pills', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status === 'RESOLVED' ? 'RESOLVED' : 'QUARANTINED';
    const pills = await projectionManager.listPoisonPills({ status, limit: clampLimit(req.query.limit) });
    res.json({ poisonPills: pills });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/events/poison-pills/{id}/retry:
 *   post:
 *     summary: Repair and replay a quarantined projection event (admin)
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               data:
 *                 type: object
 *                 description: Replacement event payload; omit to replay as-is
 *     responses:
 *       200:
 *         description: Event replayed and marked RESOLVED
 *       404:
 *         description: Poison-pill event not found
 *       422:
 *         description: Replay failed again; event stays quarantined
 */
router.post('/poison-pills/:id/retry', requireAdmin, async (req, res) => {
  try {
    const result = await projectionManager.retryPoisonPill(req.params.id, req.body?.data);
    res.status(result.resolved ? 200 : 422).json(result);
  } catch (error) {
    if (error.code === 'NOT_FOUND') return res.status(404).json({ error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export default router;
