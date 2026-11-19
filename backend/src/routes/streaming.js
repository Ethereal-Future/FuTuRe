/* backend/src/routes/streaming.js */
import express from 'express';
import { body, param, validationResult } from 'express-validator';
import * as StreamingService from '../services/streaming.js';
import logger from '../config/logger.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { requireAuth } from '../middleware/auth.js';
import { requireStreamAccess, requireStreamOwner } from '../middleware/streamAuth.js';

const router = express.Router();

// Streaming payments are per-sender user data (the swagger spec already
// documents 401 responses here); require a logged-in caller (#1102).
router.use(requireAuth);

// SSE keepalive heartbeat interval. The ALB idle_timeout is 300s, but
// intermediate proxies and clients may drop connections that stay silent for
// shorter periods. Emitting a comment heartbeat every 15s keeps bytes flowing
// on idle streams (e.g. quiet Stellar accounts) so long-polling payment
// streams are not terminated prematurely (#1442).
const SSE_KEEPALIVE_INTERVAL_MS = 15000;

/**
 * Attach a periodic SSE comment heartbeat to a streaming response.
 * Returns a cleanup function that clears the interval; callers must invoke it
 * when the client disconnects to avoid leaking timers.
 */
function attachSseKeepalive(res, intervalMs = SSE_KEEPALIVE_INTERVAL_MS) {
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(timer);
      return;
    }
    try {
      // SSE comment line: ignored by clients but keeps the connection active.
      res.write(':keepalive\n\n');
    } catch (error) {
      logger.error('streaming.route.keepalive.failed', { error: error.message });
      clearInterval(timer);
    }
  }, intervalMs);

  // Do not keep the event loop alive solely for heartbeats.
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  const cleanup = () => clearInterval(timer);
  res.on('close', cleanup);
  res.on('finish', cleanup);
  res.on('error', cleanup);

  return cleanup;
}

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
    body('rateAmount')
      .isFloat({ min: 0.00001 })
      .withMessage('rateAmount must be at least 0.00001')
      .custom((value) => {
        if (!/^\d+(\.\d{1,7})?$/.test(String(value))) {
          throw new Error('rateAmount cannot exceed 7 decimal places (1 stroop)');
        }
        return true;
      }),
    body('intervalSeconds').optional().isInt({ min: 10 }).withMessage('intervalSeconds must be at least 10'),
    body('endTime').optional().isISO8601().withMessage('endTime must be a valid ISO8601 date'),
    body('escrowContractId').isString().notEmpty().withMessage('escrowContractId is required for delegated streaming'),
    body('contractStreamId').notEmpty().withMessage('contractStreamId is required for delegated streaming'),
    body('senderSecret').not().exists().withMessage('senderSecret is not accepted; use delegated escrow'),
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
 *     parameters:
 *       - $ref: '#/components/parameters/IdempotencyKey'
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
router.post('/', idempotencyMiddleware, streamRules.create, validate, async (req, res) => {
  try {
    const stream = await StreamingService.createStream(req.body);
    res.status(201).json(withNextPaymentAt(stream));
  } catch (error) {
    logger.error('streaming.route.create.failed', { error: error.message });
    if (error.code === 'STREAM_LIMIT_EXCEEDED') {
      return res.status(429).json({ error: error.message });
    }
    if (
      error.code === 'CUSTODIAL_SECRET_REJECTED' ||
      error.code === 'DELEGATED_STREAM_REQUIRED' ||
      error.code === 'RATE_AMOUNT_INVALID' ||
      error.code === 'STREAM_SENDER_BALANCE_INSUFFICIENT' ||
      error.code === 'STREAM_RECIPIENT_TRUSTLINE_MISSING' ||
      error.code === 'STREAM_RECIPIENT_TRUSTLINE_INSUFFICIENT' ||
      error.code === 'STREAM_PREFLIGHT_HORIZON_ERROR'
    ) {
      return res.status(400).json({ error: error.message, code: error.code });
    }
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
router.get('/:id', streamRules.idParam, validate, requireStreamAccess, async (req, res) => {
  try {
    res.json(withNextPaymentAt(req.stream));
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
router.post('/:id/pause', streamRules.idParam, validate, requireStreamAccess, requireStreamOwner, async (req, res) => {
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
router.post('/:id/resume', streamRules.idParam, validate, requireStreamAccess, requireStreamOwner, async (req, res) => {
  try {
    const stream = await StreamingService.resumeStream(req.params.id);
    res.json(withNextPaymentAt(stream));
  } catch (error) {
    const statusCode = error.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/streaming/{id}/failures:
 *   get:
 *     summary: Get failure history for a payment stream
 *     tags: [Streaming]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: List of failure records for the stream
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/:id/failures', streamRules.idParam, validate, requireStreamAccess, async (req, res) => {
  try {
    const failures = await StreamingService.getStreamFailures(req.params.id);
    res.json(failures);
  } catch (error) {
    logger.error('streaming.route.failures.failed', { error: error.message });
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
router.post('/:id/cancel', streamRules.idParam, validate, requireStreamAccess, requireStreamOwner, async (req, res) => {
  try {
    const settleProrated =
      req.body?.settleProrated === true || req.query?.settleProrated === 'true';
    const stream = await StreamingService.cancelStream(req.params.id, { settleProrated });
    res.json(withNextPaymentAt(stream));
  } catch (error) {
    if (error.code === 'STREAM_PRORATED_SETTLEMENT_FAILED') {
      return res.status(502).json({ error: error.message, code: error.code });
    }
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
], validate, requireStreamAccess, requireStreamOwner, async (req, res) => {
  try {
    const stream = await StreamingService.updateStream(req.params.id, req.body);
    res.json(withNextPaymentAt(stream));
  } catch (error) {
    const statusCode = error.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ error: error.message });
  }
});

export default router;
