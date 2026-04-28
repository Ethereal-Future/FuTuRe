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
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Transaction'
 *       400:
 *         description: Invalid request parameters
 *       500:
 *         description: Server error
 */
router.get('/:accountId', rules.accountIdParam, validate, async (req, res) => {
  try {
    const { accountId } = req.params;
    const options = {
      limit: parseInt(req.query.limit) || 20,
      cursor: req.query.cursor,
      order: req.query.order || 'desc',
      includeFailed: req.query.includeFailed === 'true',
      asset: req.query.asset,
      startTime: req.query.startTime,
      endTime: req.query.endTime
    };

    const transactions = await transactionService.getTransactions(accountId, options);
    res.json(transactions);
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
 *         description: The Stellar account public key
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search query
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
 *       400:
 *         description: Missing search query
 *       500:
 *         description: Server error
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
 *       500:
 *         description: Server error
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
 *         description: The Stellar account public key
 *     responses:
 *       200:
 *         description: Latest transaction
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Transaction'
 *       404:
 *         description: No transactions found
 *       500:
 *         description: Server error
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
 *         description: The Stellar account public key
 *     responses:
 *       200:
 *         description: Monitoring started
 *       500:
 *         description: Server error
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
 *         description: The Stellar account public key
 *     responses:
 *       200:
 *         description: Monitoring stopped
 *       500:
 *         description: Server error
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
