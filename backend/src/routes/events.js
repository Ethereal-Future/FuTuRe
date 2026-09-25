import express from 'express';
import {
  eventMonitor,
  eventStore,
  eventReplayer,
  projectionManager,
  eventArchiver,
  eventAnalytics
} from '../eventSourcing/index.js';
import { requireAuth, requireAdmin, requireOwnAccount } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);

/**
 * @swagger
 * /api/events/history/{aggregateId}:
 *   get:
 *     summary: Get event history for an aggregate
 *     description: "Known limitation: event-sourcing state is in-memory, so it is not durable across deploys or shared across instances. See docs/guides/internal-tooling.md#event-sourcing"
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: aggregateId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Event history retrieved
 */
router.get('/history/:aggregateId', requireOwnAccount('aggregateId'), async (req, res) => {
  try {
    const events = await eventMonitor.getEventHistory(req.params.aggregateId);
    res.json({ aggregateId: req.params.aggregateId, events });
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
 * /api/events/projections/status:
 *   get:
 *     summary: Projection sync health
 *     description: Per-projection dead-letter backlog, last processed event, lag and last error. Returns 503 when any projection has undelivered events.
 *     tags: [Events]
 *     responses:
 *       200:
 *         description: All projections are in sync
 *       503:
 *         description: One or more projections have pending dead letters
 */
router.get('/projections/status', requireAdmin, async (req, res) => {
  try {
    const status = await eventMonitor.getProjectionStatus();
    res.status(status.healthy ? 200 : 503).json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/events/projections/{name}/retry:
 *   post:
 *     summary: Re-deliver a projection's dead-lettered events in order
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 */
router.post('/projections/:name/retry', requireAdmin, async (req, res) => {
  try {
    const result = await eventMonitor.retryDeadLetters(req.params.name);
    res.status(result.remaining === 0 ? 200 : 409).json({ name: req.params.name, ...result });
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

export default router;
