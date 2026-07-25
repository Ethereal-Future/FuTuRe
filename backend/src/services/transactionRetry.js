import { EventEmitter } from 'events';

/**
 * Transaction Retry Service with exponential backoff and circuit breaker
 */
class TransactionRetryService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      maxRetries: config.maxRetries || 5,
      initialDelay: config.initialDelay || 1000,
      maxDelay: config.maxDelay || 30000,
      backoffMultiplier: config.backoffMultiplier || 2,
      circuitBreakerThreshold: config.circuitBreakerThreshold || 10,
      circuitBreakerTimeout: config.circuitBreakerTimeout || 60000,
      ...config
    };

    this.retryAttempts = new Map();
    this.circuitBreaker = {
      failures: 0,
      state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
      lastFailureTime: null
    };
  }

  /**
   * Execute transaction with retry logic
   */
  async executeWithRetry(transactionFn, transactionId, options = {}) {
    const maxRetries = options.maxRetries || this.config.maxRetries;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        // Check circuit breaker
        if (this.circuitBreaker.state === 'OPEN') {
          if (Date.now() - this.circuitBreaker.lastFailureTime > this.config.circuitBreakerTimeout) {
            this.circuitBreaker.state = 'HALF_OPEN';
            this.emit('circuitBreakerHalfOpen');
          } else {
            throw new Error('Circuit breaker is OPEN');
          }
        }

        // Execute transaction
        const result = await transactionFn();

        // Success - reset circuit breaker
        this.circuitBreaker.failures = 0;
        if (this.circuitBreaker.state === 'HALF_OPEN') {
          this.circuitBreaker.state = 'CLOSED';
          this.emit('circuitBreakerClosed');
        }

        // Clear retry attempts
        this.retryAttempts.delete(transactionId);

        this.emit('transactionSuccess', { transactionId, attempt });
        return result;

      } catch (error) {
        attempt++;
        
        // Store retry attempt
        const attempts = this.retryAttempts.get(transactionId) || [];
        attempts.push({
          attempt,
          timestamp: new Date(),
          error: error.message,
          errorType: this.classifyError(error)
        });
        this.retryAttempts.set(transactionId, attempts);

        // Update circuit breaker
        this.circuitBreaker.failures++;
        if (this.circuitBreaker.failures >= this.config.circuitBreakerThreshold) {
          this.circuitBreaker.state = 'OPEN';
          this.circuitBreaker.lastFailureTime = Date.now();
          this.emit('circuitBreakerOpen', { failures: this.circuitBreaker.failures });
        }

        // Emit retry event
        this.emit('transactionRetry', {
          transactionId,
          attempt,
          maxRetries,
          error: error.message,
          errorType: this.classifyError(error)
        });

        // Check if should retry
        if (attempt > maxRetries || !this.shouldRetry(error)) {
          this.emit('transactionFailed', {
            transactionId,
            attempts: attempt,
            error: error.message
          });
          throw error;
        }

        // Calculate delay with exponential backoff
        const delay = this.calculateDelay(attempt);
        await this.sleep(delay);
      }
    }
  }

  /**
   * Classify error type for different handling strategies
   */
  classifyError(error) {
    const message = error.message?.toLowerCase() || '';

    if (message.includes('timeout') || message.includes('econnrefused')) {
      return 'NETWORK';
    }
    if (message.includes('insufficient') || message.includes('balance')) {
      return 'INSUFFICIENT_FUNDS';
    }
    if (message.includes('sequence')) {
      return 'SEQUENCE_ERROR';
    }
    if (message.includes('rate limit')) {
      return 'RATE_LIMIT';
    }
    if (message.includes('invalid')) {
      return 'VALIDATION';
    }

    return 'UNKNOWN';
  }

  /**
   * Determine if error is retryable
   */
  shouldRetry(error) {
    const errorType = this.classifyError(error);

    // Don't retry validation errors or insufficient funds
    if (errorType === 'VALIDATION' || errorType === 'INSUFFICIENT_FUNDS') {
      return false;
    }

    // Retry network, rate limit, and sequence errors
    return ['NETWORK', 'RATE_LIMIT', 'SEQUENCE_ERROR', 'UNKNOWN'].includes(errorType);
  }

  /**
   * Calculate delay with exponential backoff
   */
  calculateDelay(attempt) {
    const delay = Math.min(
      this.config.initialDelay * Math.pow(this.config.backoffMultiplier, attempt - 1),
      this.config.maxDelay
    );

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return delay + jitter;
  }

  /**
   * Get retry attempts for a transaction
   */
  getRetryAttempts(transactionId) {
    return this.retryAttempts.get(transactionId) || [];
  }

  /**
   * Get retry statistics
   */
  getRetryStats() {
    const stats = {
      totalTransactions: this.retryAttempts.size,
      circuitBreakerState: this.circuitBreaker.state,
      circuitBreakerFailures: this.circuitBreaker.failures,
      retryDistribution: {}
    };

    for (const [, attempts] of this.retryAttempts) {
      const count = attempts.length;
      stats.retryDistribution[count] = (stats.retryDistribution[count] || 0) + 1;
    }

    return stats;
  }

  /**
   * Reset circuit breaker manually
   */
  resetCircuitBreaker() {
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.state = 'CLOSED';
    this.circuitBreaker.lastFailureTime = null;
    this.emit('circuitBreakerReset');
  }

  /**
   * Clear retry history
   */
  clearRetryHistory(transactionId = null) {
    if (transactionId) {
      this.retryAttempts.delete(transactionId);
    } else {
      this.retryAttempts.clear();
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default TransactionRetryService;
