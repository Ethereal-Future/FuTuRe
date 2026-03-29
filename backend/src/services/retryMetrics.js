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
   * Record a retry attempt
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
   * Record successful retry
   */
  recordSuccess(data) {
    this.metrics.successfulRetries++;
  }

  /**
   * Record failed retry
   */
  recordFailure(data) {
    this.metrics.failedRetries++;
  }

  /**
   * Record circuit breaker trip
   */
  recordCircuitBreakerTrip() {
    this.metrics.circuitBreakerTrips++;
  }

  /**
   * Get current metrics
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
   * Get metrics for a specific time period
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
   * Reset metrics
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
   * Export metrics for monitoring systems
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
