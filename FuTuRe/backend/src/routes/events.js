import express from 'express';
import {
  eventMonitor,
  eventStore,
  eventReplayer,
  projectionManager,
  eventArchiver,
  eventAnalytics
} from '../eventSourcing/index.js';

const router = express.Router();

/**
 * @swagger
 * /api/events/history/{aggregateId}:
 *   get:
 *     summary: Get event history for an aggregate
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
router.get('/history/:aggregateId', async (req, res) => {
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
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: aggregateId
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/state/:aggregateId', async (req, res) => {
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
router.get('/replay/:aggregateId', async (req, res) => {
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
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/projection/:name', async (req, res) => {
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
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: eventType
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/analytics/:eventType', async (req, res) => {
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
 *     tags: [Events]
 */
router.get('/stats', async (req, res) => {
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
router.post('/archive', async (req, res) => {
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
router.get('/all', async (req, res) => {
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
