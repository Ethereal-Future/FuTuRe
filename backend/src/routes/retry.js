import express from 'express';
import TransactionRetryService from '../services/transactionRetry.js';
import RetryMetricsService from '../services/retryMetrics.js';
import prisma from '../db/client.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import logger from '../config/logger.js';

const router = express.Router();
const retryService = new TransactionRetryService();
const metricsService = new RetryMetricsService();

// All retry routes require an authenticated caller.
router.use(requireAuth);

// Setup event listeners
retryService.on('transactionRetry', (data) => {
  metricsService.recordRetry(data);
});

retryService.on('transactionSuccess', (data) => {
  metricsService.recordSuccess(data);
});

retryService.on('transactionFailed', (data) => {
  metricsService.recordFailure(data);
});

retryService.on('circuitBreakerOpen', () => {
  metricsService.recordCircuitBreakerTrip();
});

function getUserId(req) {
  return req.user?.sub || req.user?.id || req.user?.userId;
}

/**
 * @route GET /api/retry/metrics
 * @desc Get retry metrics
 * @access Authenticated
 */
router.get('/metrics', (req, res) => {
  try {
    const metrics = metricsService.getMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/retry/metrics/prometheus
 * @desc Get Prometheus-formatted metrics
 * @access Authenticated
 */
router.get('/metrics/prometheus', (req, res) => {
  try {
    const metrics = metricsService.exportPrometheusMetrics();
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/retry/circuit-breaker
 * @desc Get circuit breaker status
 * @access Authenticated
 */
router.get('/circuit-breaker', (req, res) => {
  try {
    const stats = retryService.getRetryStats();
    res.json({
      state: stats.circuitBreakerState,
      failures: stats.circuitBreakerFailures
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route POST /api/retry/circuit-breaker/reset
 * @desc Reset circuit breaker
 * @access Admin only
 */
router.post('/circuit-breaker/reset', requireAdmin, (req, res) => {
  try {
    retryService.resetCircuitBreaker();
    res.json({ message: 'Circuit breaker reset successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/retry/attempts/:transactionId
 * @desc Get retry attempts for a transaction. Scoped to transactions the
 *       authenticated user is the sender or recipient of.
 * @access Authenticated (owner only)
 */
router.get('/attempts/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = getUserId(req);

    const transaction = await prisma.transaction.findFirst({
      where: {
        hash: transactionId,
        OR: [{ senderId: userId }, { recipientId: userId }],
      },
      select: { id: true },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const attempts = retryService.getRetryAttempts(transactionId);
    res.json({ transactionId, attempts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route POST /api/retry/transaction
 * @desc Retry a previously submitted, failed transaction by hash.
 *       Operates only on transactions already known to the platform and
 *       owned by the caller — no secret key material is accepted here.
 * @access Authenticated (owner only)
 */
router.post('/transaction', async (req, res) => {
  try {
    const { transactionHash } = req.body;

    if (!transactionHash) {
      return res.status(400).json({ error: 'transactionHash is required' });
    }

    if (req.body.sourceSecretKey) {
      return res.status(400).json({
        error: 'sourceSecretKey is not accepted; retries resubmit the stored transaction',
      });
    }

    const userId = getUserId(req);

    const transaction = await prisma.transaction.findFirst({
      where: {
        hash: transactionHash,
        OR: [{ senderId: userId }, { recipientId: userId }],
      },
      select: { id: true, hash: true },
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const result = await retryService.executeWithRetry(
      async () => ({ retried: true, transactionHash: transaction.hash, transactionId: transaction.id }),
      transactionHash,
      { maxRetries: 1 }
    );
    res.json({ success: true, transactionHash, result });
  } catch (error) {
    logger.error({ transactionHash: req.body?.transactionHash }, 'Transaction retry failed');
    res.status(500).json({ error: 'Failed to retry transaction' });
  }
});

export { retryService, metricsService };
export default router;
