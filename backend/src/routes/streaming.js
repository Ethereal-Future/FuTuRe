/* backend/src/routes/streaming.js */
import express from 'express';
import { body, param, validationResult } from 'express-validator';
import * as StreamingService from '../services/streaming.js';
import logger from '../config/logger.js';

const router = express.Router();

function withNextPaymentAt(stream) {
  return {
    ...stream,
    nextPaymentAt: stream.status === 'ACTIVE'
      ? new Date(new Date(stream.lastProcessedAt).getTime() + stream.intervalSeconds * 1000)
      : null,
  };
}

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
 *             $ref: '#/components/schemas/CreateStreamRequest'
 *           example:
 *             senderPublicKey: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *             recipientPublicKey: GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON
 *             assetCode: XLM
 *             rateAmount: 1.5
 *             intervalSeconds: 60
 *             endTime: '2026-12-31T23:59:59.000Z'
 *     responses:
 *       201:
 *         description: Stream created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StreamResponse'
 *             example:
 *               id: 550e8400-e29b-41d4-a716-446655440000
 *               status: ACTIVE
 *               assetCode: XLM
 *               rateAmount: 1.5
 *               intervalSeconds: 60
 *               totalStreamed: 0
 *               nextPaymentAt: '2026-03-15T14:01:00.000Z'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/', streamRules.create, validate, async (req, res) => {
  try {
    const stream = await StreamingService.createStream(req.body);
    res.status(201).json(withNextPaymentAt(stream));
  } catch (error) {
    logger.error('streaming.route.create.failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/streaming:
 *   get:
 *     summary: List streaming payments for a sender
 *     tags: [Streaming]
 *     parameters:
 *       - in: query
 *         name: senderPublicKey
 *         schema:
 *           type: string
 *         required: true
 *         example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *         description: Sender's public key to filter streams
 *     responses:
 *       200:
 *         description: List of streams
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/StreamResponse'
 *             example:
 *               - id: 550e8400-e29b-41d4-a716-446655440000
 *                 status: ACTIVE
 *                 assetCode: XLM
 *                 rateAmount: 1.5
 *                 intervalSeconds: 60
 *                 totalStreamed: 45.0
 *                 nextPaymentAt: '2026-03-15T14:01:00.000Z'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/', async (req, res) => {
  try {
    const { senderPublicKey } = req.query;
    if (!senderPublicKey) {
      return res.status(400).json({ error: 'senderPublicKey query parameter is required' });
    }

    const streams = await StreamingService.prisma.paymentStream.findMany({
      where: { sender: { publicKey: senderPublicKey } },
      include: { sender: true, recipient: true },
      orderBy: { startTime: 'desc' },
    });

    const enriched = streams.map(withNextPaymentAt);

    res.json(enriched);
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
 *         description: Streaming analytics data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalVolume: { type: string }
 *                 activeStreams: { type: integer }
 *                 pausedStreams: { type: integer }
 *                 failedStreams: { type: integer }
 *                 completedStreams: { type: integer }
 *                 cancelledStreams: { type: integer }
 *                 totalStreams: { type: integer }
 *                 topAssets:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       assetCode: { type: string }
 *                       count: { type: integer }
 *             example:
 *               totalVolume: '12450.0000000'
 *               activeStreams: 8
 *               pausedStreams: 2
 *               failedStreams: 1
 *               completedStreams: 5
 *               cancelledStreams: 3
 *               totalStreams: 19
 *               topAssets:
 *                 - assetCode: XLM
 *                   count: 15
 *                 - assetCode: USDC
 *                   count: 4
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
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
 *         schema:
 *           type: string
 *           format: uuid
 *         example: 550e8400-e29b-41d4-a716-446655440000
 *     responses:
 *       200:
 *         description: Stream details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StreamResponse'
 *             example:
 *               id: 550e8400-e29b-41d4-a716-446655440000
 *               status: ACTIVE
 *               assetCode: XLM
 *               rateAmount: 1.5
 *               intervalSeconds: 60
 *               totalStreamed: 45.0
 *               nextPaymentAt: '2026-03-15T14:01:00.000Z'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/:id', streamRules.idParam, validate, async (req, res) => {
  try {
    const stream = await StreamingService.prisma.paymentStream.findUnique({
      where: { id: req.params.id },
      include: { sender: true, recipient: true },
    });
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    res.json(withNextPaymentAt(stream));
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
 *         schema:
 *           type: string
 *           format: uuid
 *         example: 550e8400-e29b-41d4-a716-446655440000
 *     responses:
 *       200:
 *         description: Stream paused successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StreamResponse'
 *             example:
 *               id: 550e8400-e29b-41d4-a716-446655440000
 *               status: PAUSED
 *               assetCode: XLM
 *               rateAmount: 1.5
 *               intervalSeconds: 60
 *               totalStreamed: 45.0
 *               nextPaymentAt: null
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/:id/pause', streamRules.idParam, validate, async (req, res) => {
  try {
    const stream = await StreamingService.pauseStream(req.params.id);
    res.json(withNextPaymentAt(stream));
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
 *         schema:
 *           type: string
 *           format: uuid
 *         example: 550e8400-e29b-41d4-a716-446655440000
 *     responses:
 *       200:
 *         description: Stream resumed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StreamResponse'
 *             example:
 *               id: 550e8400-e29b-41d4-a716-446655440000
 *               status: ACTIVE
 *               assetCode: XLM
 *               rateAmount: 1.5
 *               intervalSeconds: 60
 *               totalStreamed: 45.0
 *               nextPaymentAt: '2026-03-15T14:01:00.000Z'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/:id/resume', streamRules.idParam, validate, async (req, res) => {
  try {
    const stream = await StreamingService.resumeStream(req.params.id);
    res.json(withNextPaymentAt(stream));
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
 *         schema:
 *           type: string
 *           format: uuid
 *         example: 550e8400-e29b-41d4-a716-446655440000
 *     responses:
 *       200:
 *         description: Stream cancelled successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StreamResponse'
 *             example:
 *               id: 550e8400-e29b-41d4-a716-446655440000
 *               status: CANCELLED
 *               assetCode: XLM
 *               rateAmount: 1.5
 *               intervalSeconds: 60
 *               totalStreamed: 45.0
 *               nextPaymentAt: null
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/:id/cancel', streamRules.idParam, validate, async (req, res) => {
  try {
    const stream = await StreamingService.cancelStream(req.params.id);
    res.json(withNextPaymentAt(stream));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/streaming/{id}:
 *   patch:
 *     summary: Update a streaming payment (rate, interval, or endTime)
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: 550e8400-e29b-41d4-a716-446655440000
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateStreamRequest'
 *           example:
 *             rateAmount: 2.0
 *             intervalSeconds: 120
 *             endTime: '2027-01-01T00:00:00.000Z'
 *     responses:
 *       200:
 *         description: Stream updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StreamResponse'
 *             example:
 *               id: 550e8400-e29b-41d4-a716-446655440000
 *               status: ACTIVE
 *               assetCode: XLM
 *               rateAmount: 2.0
 *               intervalSeconds: 120
 *               totalStreamed: 45.0
 *               nextPaymentAt: '2026-03-15T14:02:00.000Z'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.patch('/:id', streamRules.idParam, [
  body('rateAmount').optional().isFloat({ gt: 0 }).withMessage('rateAmount must be a positive number'),
  body('intervalSeconds').optional().isInt({ min: 10 }).withMessage('intervalSeconds must be at least 10'),
  body('endTime').optional().isISO8601().withMessage('endTime must be a valid ISO8601 date'),
], validate, async (req, res) => {
  try {
    const stream = await StreamingService.updateStream(req.params.id, req.body);
    res.json(withNextPaymentAt(stream));
  } catch (error) {
    const statusCode = error.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ error: error.message });
  }
});

export default router;
