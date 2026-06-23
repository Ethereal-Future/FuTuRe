import express from 'express';
import { transactionService } from '../services/transactions.js';
import { validate, rules } from '../middleware/validate.js';
import { broadcastToAccount } from '../services/websocket.js';
import logger from '../config/logger.js';

const router = express.Router();

function logError(req, error, context = {}) {
  logger.error('route.error', {
    requestId: req.id,
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
    ...context,
    error: error.message,
    stack: error.stack,
  });
}

/**
 * @swagger
 * /api/transactions/{accountId}:
 *   get:
 *     summary: Get transaction history for an account
 *     description: Retrieves paginated transaction history with optional filtering
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *         description: The Stellar account public key
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Number of transactions to return (max 100)
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order
 *       - in: query
 *         name: includeFailed
 *         schema:
 *           type: boolean
 *         description: Include failed transactions
 *       - in: query
 *         name: asset
 *         schema:
 *           type: string
 *         description: Filter by asset code
 *       - in: query
 *         name: startTime
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Start time filter (ISO 8601)
 *       - in: query
 *         name: endTime
 *         schema:
 *           type: string
 *           format: date-time
 *         description: End time filter (ISO 8601)
 *     responses:
 *       200:
 *         description: Transaction history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Transaction'
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 pageSize: { type: integer }
 *                 nextCursor: { type: string, nullable: true }
 *             example:
 *               data:
 *                 - hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
 *                   type: payment
 *                   direction: sent
 *                   amount: '10.5000000'
 *                   asset: XLM
 *                   date: '2026-03-15T14:22:00Z'
 *                   successful: true
 *                   ledger: 48392011
 *               total: 1
 *               page: 1
 *               pageSize: 20
 *               nextCursor: null
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/:accountId', rules.accountIdParam, validate, async (req, res) => {
  try {
    const { accountId } = req.params;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || parseInt(req.query.limit) || 20));

    const options = {
      limit: pageSize,
      cursor: req.query.cursor,
      order: req.query.order || 'desc',
      includeFailed: req.query.includeFailed === 'true',
      asset: req.query.asset,
      startTime: req.query.startTime,
      endTime: req.query.endTime
    };

    const data = await transactionService.getTransactions(accountId, options);
    const nextCursor = data.length === pageSize ? (data[data.length - 1]?.paging_token ?? null) : null;

    res.json({
      data,
      total: data.length,
      page,
      pageSize,
      totalPages: null,
      nextCursor,
    });
  } catch (error) {
    logError(req, error, { accountId: req.params.accountId });
    res.status(500).json({ error: 'Failed to retrieve transactions' });
  }
});

/**
 * @swagger
 * /api/transactions/{accountId}/search:
 *   get:
 *     summary: Search transactions
 *     description: Search transactions by hash, memo, operation type, or asset
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *         description: The Stellar account public key
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         example: Invoice #42
 *         description: Search query (matches hash prefix, memo, operation type, or asset)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         description: Number of results to return
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Transaction'
 *             example:
 *               - hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
 *                 type: payment
 *                 direction: sent
 *                 amount: '10.5000000'
 *                 asset: XLM
 *                 memo: Invoice #42
 *                 date: '2026-03-15T14:22:00Z'
 *                 successful: true
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/:accountId/search', rules.accountIdParam, validate, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { q: searchTerm, limit = 50 } = req.query;

    if (!searchTerm) {
      return res.status(400).json({ error: 'Search query parameter "q" is required' });
    }

    const results = await transactionService.searchTransactions(accountId, searchTerm, { limit });
    res.json(results);
  } catch (error) {
    logError(req, error, { accountId: req.params.accountId });
    res.status(500).json({ error: 'Failed to search transactions' });
  }
});

/**
 * @swagger
 * /api/transactions/{accountId}/analytics:
 *   get:
 *     summary: Get transaction analytics
 *     description: Get analytics data for transaction history
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *         description: The Stellar account public key
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [24h, 7d, 30d, 90d]
 *         description: Timeframe for analytics
 *     responses:
 *       200:
 *         description: Analytics data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TransactionAnalytics'
 *             example:
 *               totalTransactions: 142
 *               successfulTransactions: 138
 *               failedTransactions: 4
 *               totalVolume: 5420.75
 *               averageFee: 0.00001
 *               operationTypes:
 *                 payment: 120
 *                 create_account: 10
 *                 change_trust: 12
 *               dailyVolume:
 *                 '2026-03-01': 320
 *                 '2026-03-02': 410
 *               assets:
 *                 - XLM
 *                 - USDC
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.get('/:accountId/analytics', rules.accountIdParam, validate, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { timeframe = '30d' } = req.query;

    const analytics = await transactionService.getTransactionAnalytics(accountId, timeframe);
    res.json(analytics);
  } catch (error) {
    logError(req, error, { accountId: req.params.accountId });
    res.status(500).json({ error: 'Failed to retrieve transaction analytics' });
  }
});

/**
 * @swagger
 * /api/transactions/{accountId}/latest:
 *   get:
 *     summary: Get latest transaction
 *     description: Get the most recent transaction for an account
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *         description: The Stellar account public key
 *     responses:
 *       200:
 *         description: Latest transaction
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Transaction'
 *             example:
 *               hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
 *               type: payment
 *               direction: sent
 *               amount: '10.5000000'
 *               asset: XLM
 *               date: '2026-03-15T14:22:00Z'
 *               successful: true
 *               ledger: 48392011
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
router.get('/:accountId/latest', rules.accountIdParam, validate, async (req, res) => {
  try {
    const { accountId } = req.params;
    const transaction = await transactionService.getLatestTransaction(accountId);

    if (!transaction) {
      return res.status(404).json({ error: 'No transactions found' });
    }

    res.json(transaction);
  } catch (error) {
    logError(req, error, { accountId: req.params.accountId });
    res.status(500).json({ error: 'Failed to retrieve latest transaction' });
  }
});

/**
 * @swagger
 * /api/transactions/{accountId}/monitor:
 *   post:
 *     summary: Start transaction monitoring
 *     description: Start real-time monitoring for new transactions
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *         description: The Stellar account public key
 *     responses:
 *       200:
 *         description: Monitoring started
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *             example:
 *               message: Transaction monitoring started
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.post('/:accountId/monitor', rules.accountIdParam, validate, async (req, res) => {
  try {
    const { accountId } = req.params;
    transactionService.startMonitoring(accountId);
    res.json({ message: 'Transaction monitoring started' });
  } catch (error) {
    logError(req, error, { accountId: req.params.accountId });
    res.status(500).json({ error: 'Failed to start transaction monitoring' });
  }
});

/**
 * @swagger
 * /api/transactions/{accountId}/monitor:
 *   delete:
 *     summary: Stop transaction monitoring
 *     description: Stop real-time monitoring for an account
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: accountId
 *         required: true
 *         schema:
 *           type: string
 *         example: GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
 *         description: The Stellar account public key
 *     responses:
 *       200:
 *         description: Monitoring stopped
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *             example:
 *               message: Transaction monitoring stopped
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         $ref: '#/components/responses/InternalServerError'
 */
router.delete('/:accountId/monitor', rules.accountIdParam, validate, async (req, res) => {
  try {
    const { accountId } = req.params;
    transactionService.stopMonitoring(req.params.accountId);
    res.json({ message: 'Transaction monitoring stopped' });
  } catch (error) {
    logError(req, error, { accountId: req.params.accountId });
    res.status(500).json({ error: 'Failed to stop transaction monitoring' });
  }
});

export default router;
