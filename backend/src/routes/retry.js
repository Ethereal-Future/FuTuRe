import express from 'express';
import TransactionRetryService from '../services/transactionRetry.js';
import RetryMetricsService from '../services/retryMetrics.js';

const router = express.Router();
const retryService = new TransactionRetryService();
const metricsService = new RetryMetricsService();

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

/**
 * @route GET /api/retry/metrics
 * @desc Get retry metrics
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
 */
router.post('/circuit-breaker/reset', (req, res) => {
  try {
    retryService.resetCircuitBreaker();
    res.json({ message: 'Circuit breaker reset successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route GET /api/retry/attempts/:transactionId
 * @desc Get retry attempts for a transaction
 */
router.get('/attempts/:transactionId', (req, res) => {
  try {
    const { transactionId } = req.params;
    const attempts = retryService.getRetryAttempts(transactionId);
    res.json({ transactionId, attempts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export { retryService, metricsService };
export default router;
