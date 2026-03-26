/**
 * @swagger
 * tags:
 *   name: Jobs
 *   description: Background job queue management
 */
import express from 'express';
import { body, param, query } from 'express-validator';
import { validate } from '../middleware/validate.js';
import { createQueue, QUEUES } from '../jobs/index.js';
import {
  getQueueStats,
  getJobDetails,
  listJobs,
  retryJob,
  removeJob,
  pauseQueue,
  resumeQueue,
  cleanQueue,
  getSystemHealth,
} from '../jobs/jobMonitor.js';

const router = express.Router();
const VALID_QUEUES = Object.values(QUEUES);
const VALID_STATUSES = ['waiting', 'active', 'completed', 'failed', 'delayed'];

// ─── Enqueue ──────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/enqueue:
 *   post:
 *     summary: Enqueue a new job
 *     tags: [Jobs]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [queue, data]
 *             properties:
 *               queue:
 *                 type: string
 *                 enum: [email, payment, report, notification, maintenance]
 *               data:
 *                 type: object
 *               priority:
 *                 type: integer
 *                 description: Higher = more urgent (default 0)
 *               delay:
 *                 type: integer
 *                 description: Delay in milliseconds before processing
 *               attempts:
 *                 type: integer
 *                 description: Max retry attempts (default 3)
 *     responses:
 *       201:
 *         description: Job enqueued
 *       422:
 *         description: Validation error
 */
router.post(
  '/enqueue',
  [
    body('queue').isIn(VALID_QUEUES).withMessage(`queue must be one of: ${VALID_QUEUES.join(', ')}`),
    body('data').isObject().withMessage('data must be an object'),
    body('priority').optional().isInt({ min: 0, max: 100 }),
    body('delay').optional().isInt({ min: 0 }),
    body('attempts').optional().isInt({ min: 1, max: 10 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { queue: queueName, data, priority = 0, delay = 0, attempts = 3 } = req.body;
      const queue = createQueue(queueName);
      const job = await queue.add(data, {
        priority,
        delay,
        attempts,
        backoff: { type: 'exponential', delay: 1000 },
      });
      res.status(201).json({ jobId: job.id, queue: queueName, status: 'queued' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── Stats & Health ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/health:
 *   get:
 *     summary: Get overall job system health
 *     tags: [Jobs]
 *     responses:
 *       200:
 *         description: Health snapshot
 */
router.get('/health', async (_req, res) => {
  try {
    res.json(await getSystemHealth());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/jobs/stats:
 *   get:
 *     summary: Get job counts per queue
 *     tags: [Jobs]
 *     responses:
 *       200:
 *         description: Queue statistics
 */
router.get('/stats', async (_req, res) => {
  try {
    res.json(await getQueueStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Queue management ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/jobs/{queue}/jobs:
 *   get:
 *     summary: List jobs in a queue
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: queue
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [waiting, active, completed, failed, delayed]
 *       - in: query
 *         name: start
 *         schema:
 *           type: integer
 *       - in: query
 *         name: end
 *         schema:
 *           type: integer
 */
router.get(
  '/:queue/jobs',
  [
    param('queue').isIn(VALID_QUEUES),
    query('status').optional().isIn(VALID_STATUSES),
    query('start').optional().isInt({ min: 0 }),
    query('end').optional().isInt({ min: 0 }),
  ],
  validate,
  async (req, res) => {
    try {
      const { queue } = req.params;
      const { status = 'waiting', start = 0, end = 49 } = req.query;
      res.json(await listJobs(queue, status, Number(start), Number(end)));
    } catch (err) {
      res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
    }
  }
);

/**
 * @swagger
 * /api/jobs/{queue}/jobs/{jobId}:
 *   get:
 *     summary: Get job details
 *     tags: [Jobs]
 */
router.get(
  '/:queue/jobs/:jobId',
  [param('queue').isIn(VALID_QUEUES), param('jobId').notEmpty()],
  validate,
  async (req, res) => {
    try {
      res.json(await getJobDetails(req.params.queue, req.params.jobId));
    } catch (err) {
      res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
    }
  }
);

/**
 * @swagger
 * /api/jobs/{queue}/jobs/{jobId}/retry:
 *   post:
 *     summary: Retry a failed job
 *     tags: [Jobs]
 */
router.post(
  '/:queue/jobs/:jobId/retry',
  [param('queue').isIn(VALID_QUEUES), param('jobId').notEmpty()],
  validate,
  async (req, res) => {
    try {
      res.json(await retryJob(req.params.queue, req.params.jobId));
    } catch (err) {
      res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
    }
  }
);

/**
 * @swagger
 * /api/jobs/{queue}/jobs/{jobId}:
 *   delete:
 *     summary: Remove a job
 *     tags: [Jobs]
 */
router.delete(
  '/:queue/jobs/:jobId',
  [param('queue').isIn(VALID_QUEUES), param('jobId').notEmpty()],
  validate,
  async (req, res) => {
    try {
      res.json(await removeJob(req.params.queue, req.params.jobId));
    } catch (err) {
      res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
    }
  }
);

/**
 * @swagger
 * /api/jobs/{queue}/pause:
 *   post:
 *     summary: Pause a queue
 *     tags: [Jobs]
 */
router.post('/:queue/pause', [param('queue').isIn(VALID_QUEUES)], validate, async (req, res) => {
  try {
    res.json(await pauseQueue(req.params.queue));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/jobs/{queue}/resume:
 *   post:
 *     summary: Resume a paused queue
 *     tags: [Jobs]
 */
router.post('/:queue/resume', [param('queue').isIn(VALID_QUEUES)], validate, async (req, res) => {
  try {
    res.json(await resumeQueue(req.params.queue));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/jobs/{queue}/clean:
 *   post:
 *     summary: Clean old jobs from a queue
 *     tags: [Jobs]
 */
router.post(
  '/:queue/clean',
  [
    param('queue').isIn(VALID_QUEUES),
    body('grace').optional().isInt({ min: 0 }),
    body('status').optional().isIn(VALID_STATUSES),
  ],
  validate,
  async (req, res) => {
    try {
      const { grace = 5000, status = 'completed' } = req.body;
      res.json(await cleanQueue(req.params.queue, grace, status));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
