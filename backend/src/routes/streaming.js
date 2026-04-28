/* backend/src/routes/streaming.js */
import express from 'express';
import { body, param, validationResult } from 'express-validator';
import * as StreamingService from '../services/streaming.js';
import logger from '../config/logger.js';

const router = express.Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

const streamRules = {
  create: [
    body('senderPublicKey').matches(STELLAR_PUBLIC_KEY).withMessage('Invalid sender public key'),
    body('recipientPublicKey').matches(STELLAR_PUBLIC_KEY).withMessage('Invalid recipient public key'),
    body('assetCode').optional().isString().isLength({ min: 1, max: 12 }),
    body('rateAmount').isFloat({ gt: 0 }).withMessage('rateAmount must be a positive number'),
    body('intervalSeconds').optional().isInt({ min: 10 }).withMessage('intervalSeconds must be at least 10'),
    body('endTime').optional().isISO8601().withMessage('endTime must be a valid ISO8601 date'),
  ],
  idParam: [
    param('id').isUUID().withMessage('Invalid stream ID'),
  ],
};

/**
 * @swagger
 * /api/streaming:
 *   post:
 *     summary: Create a streaming payment
 *     tags: [Streaming]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [senderPublicKey, recipientPublicKey, rateAmount]
 *             properties:
 *               senderPublicKey: { type: string }
 *               recipientPublicKey: { type: string }
 *               assetCode: { type: string, default: XLM }
 *               rateAmount: { type: number, description: Amount per interval }
 *               intervalSeconds: { type: integer, minimum: 10, default: 60 }
 *               endTime: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Stream created
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/', streamRules.create, validate, async (req, res) => {
  try {
    const stream = await StreamingService.createStream(req.body);
    res.status(201).json(stream);
  } catch (error) {
    logger.error('streaming.route.create.failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/streaming:
 *   get:
 *     summary: List streaming payments
 *     tags: [Streaming]
 *     parameters:
 *       - in: query
 *         name: senderPublicKey
 *         schema: { type: string }
 *         description: Filter by sender public key
 *     responses:
 *       200:
 *         description: List of streams
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  try {
    const { senderPublicKey } = req.query;
    const where = senderPublicKey
      ? { sender: { publicKey: senderPublicKey } }
      : {};
    const streams = await StreamingService.prisma.paymentStream.findMany({
      where,
      include: { sender: true, recipient: true },
      orderBy: { startTime: 'desc' },
    });
    res.json(streams);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/streaming/analytics:
 *   get:
 *     summary: Get streaming payment analytics
 *     tags: [Streaming]
 *     responses:
 *       200:
 *         description: Analytics data
 *       500:
 *         description: Server error
 */
router.get('/analytics', async (req, res) => {
  try {
    const analytics = await StreamingService.getStreamAnalytics();
    res.json(analytics);
  } catch (error) {
    logger.error('streaming.route.analytics.failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/streaming/{id}:
 *   get:
 *     summary: Get a streaming payment by ID
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Stream details
 *       404:
 *         description: Stream not found
 *       500:
 *         description: Server error
 */
router.get('/:id', streamRules.idParam, validate, async (req, res) => {
  try {
    const stream = await StreamingService.prisma.paymentStream.findUnique({
      where: { id: req.params.id },
      include: { sender: true, recipient: true },
    });
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    res.json(stream);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/streaming/{id}/pause:
 *   post:
 *     summary: Pause a streaming payment
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Stream paused
 *       500:
 *         description: Server error
 */
router.post('/:id/pause', streamRules.idParam, validate, async (req, res) => {
  try {
    const stream = await StreamingService.pauseStream(req.params.id);
    res.json(stream);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/streaming/{id}/resume:
 *   post:
 *     summary: Resume a paused streaming payment
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Stream resumed
 *       500:
 *         description: Server error
 */
router.post('/:id/resume', streamRules.idParam, validate, async (req, res) => {
  try {
    const stream = await StreamingService.resumeStream(req.params.id);
    res.json(stream);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/streaming/{id}/cancel:
 *   post:
 *     summary: Cancel a streaming payment
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Stream cancelled
 *       500:
 *         description: Server error
 */
router.post('/:id/cancel', streamRules.idParam, validate, async (req, res) => {
  try {
    const stream = await StreamingService.cancelStream(req.params.id);
    res.json(stream);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
