/**
 * Retry Metrics and Monitoring Service
 */
class RetryMetricsService {
  constructor() {
    this.metrics = {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      retryByErrorType: {},
      retryByAttempt: {},
      averageRetryDelay: 0,
      circuitBreakerTrips: 0
    };

    this.recentRetries = [];
    this.maxRecentRetries = 100;
  }

  /**
   * Record a retry attempt, tracked by error type and attempt number, and appended to the recent-retry ring buffer.
   * @param {object} data - Retry details
   * @param {string} [data.errorType='UNKNOWN'] - Category of the error that triggered the retry
   * @param {number} [data.attempt=1] - Attempt number for this retry
   * @returns {void}
   */
  recordRetry(data) {
    this.metrics.totalRetries++;
    
    // Track by error type
    const errorType = data.errorType || 'UNKNOWN';
    this.metrics.retryByErrorType[errorType] = (this.metrics.retryByErrorType[errorType] || 0) + 1;

    // Track by attempt number
    const attempt = data.attempt || 1;
    this.metrics.retryByAttempt[attempt] = (this.metrics.retryByAttempt[attempt] || 0) + 1;

    // Store recent retry
    this.recentRetries.push({
      ...data,
      timestamp: new Date()
    });

    if (this.recentRetries.length > this.maxRecentRetries) {
      this.recentRetries.shift();
    }
  }

  /**
   * Increment the successful-retry counter.
   * @param {object} [data] - Unused; accepted for call-site symmetry with {@link recordFailure}
   * @returns {void}
   */
  recordSuccess(data) {
    this.metrics.successfulRetries++;
  }

  /**
   * Increment the failed-retry counter.
   * @param {object} [data] - Unused; accepted for call-site symmetry with {@link recordSuccess}
   * @returns {void}
   */
  recordFailure(data) {
    this.metrics.failedRetries++;
  }

  /**
   * Increment the circuit-breaker-trip counter.
   * @returns {void}
   */
  recordCircuitBreakerTrip() {
    this.metrics.circuitBreakerTrips++;
  }

  /**
   * Get a snapshot of all retry metrics, including derived success rate and the last 10 retries.
   * @returns {object} Current metrics plus `successRate` and `recentRetries`
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalRetries > 0
        ? (this.metrics.successfulRetries / this.metrics.totalRetries * 100).toFixed(2)
        : 0,
      recentRetries: this.recentRetries.slice(-10)
    };
  }

  /**
   * Filter the recent-retry ring buffer to a time window.
   * Note: since only the last `maxRecentRetries` retries are retained, older retries
   * within the window will not appear once the buffer has rolled past them.
   * @param {Date} startTime - Inclusive lower bound
   * @param {Date} endTime - Inclusive upper bound
   * @returns {{count: number, retries: object[]}} Matching retries and their count
   */
  getMetricsForPeriod(startTime, endTime) {
    const periodRetries = this.recentRetries.filter(r => {
      const timestamp = new Date(r.timestamp);
      return timestamp >= startTime && timestamp <= endTime;
    });

    return {
      count: periodRetries.length,
      retries: periodRetries
    };
  }

  /**
   * Reset all metrics and the recent-retry buffer to their initial state.
   * @returns {void}
   */
  reset() {
    this.metrics = {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      retryByErrorType: {},
      retryByAttempt: {},
      averageRetryDelay: 0,
      circuitBreakerTrips: 0
    };
    this.recentRetries = [];
  }

  /**
   * Render current metrics in Prometheus text exposition format.
   * @returns {string} Prometheus-formatted metrics text
   */
  exportPrometheusMetrics() {
    const lines = [];
    
    lines.push('# HELP transaction_retries_total Total number of transaction retries');
    lines.push('# TYPE transaction_retries_total counter');
    lines.push(`transaction_retries_total ${this.metrics.totalRetries}`);
    
    lines.push('# HELP transaction_retries_successful Successful retries');
    lines.push('# TYPE transaction_retries_successful counter');
    lines.push(`transaction_retries_successful ${this.metrics.successfulRetries}`);
    
    lines.push('# HELP transaction_retries_failed Failed retries');
    lines.push('# TYPE transaction_retries_failed counter');
    lines.push(`transaction_retries_failed ${this.metrics.failedRetries}`);
    
    lines.push('# HELP circuit_breaker_trips Circuit breaker trips');
    lines.push('# TYPE circuit_breaker_trips counter');
    lines.push(`circuit_breaker_trips ${this.metrics.circuitBreakerTrips}`);

    return lines.join('\n');
  }
}

export default RetryMetricsService;
