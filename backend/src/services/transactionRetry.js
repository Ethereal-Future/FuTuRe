import { EventEmitter } from 'events';

/**
 * Transaction Retry Service with exponential backoff and circuit breaker
 */
class TransactionRetryService extends EventEmitter {
  /**
   * @param {object} [config]
   * @param {number} [config.maxRetries=5] - Default max retry attempts per transaction
   * @param {number} [config.initialDelay=1000] - Initial backoff delay in ms
   * @param {number} [config.maxDelay=30000] - Max backoff delay in ms
   * @param {number} [config.backoffMultiplier=2] - Exponential backoff multiplier
   * @param {number} [config.circuitBreakerThreshold=10] - Consecutive failures before opening the circuit
   * @param {number} [config.circuitBreakerTimeout=60000] - Ms an open circuit stays open before allowing a half-open probe
   */
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
   * Execute a transaction function with exponential-backoff retry and circuit breaker protection.
   * Emits `transactionSuccess`, `transactionRetry`, `transactionFailed`, `circuitBreakerOpen`,
   * `circuitBreakerHalfOpen`, and `circuitBreakerClosed` events as appropriate.
   * @param {() => Promise<any>} transactionFn - The operation to execute
   * @param {string} transactionId - Id used to track retry history for this operation
   * @param {object} [options]
   * @param {number} [options.maxRetries] - Overrides the service's default max retries for this call
   * @returns {Promise<any>} The resolved value of `transactionFn`
   * @throws {Error} If the circuit breaker is open, the error is not retryable, or retries are exhausted
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
   * Classify an error into a coarse category for retry/logging decisions.
   * @param {Error} error - Error to classify
   * @returns {'NETWORK'|'INSUFFICIENT_FUNDS'|'SEQUENCE_ERROR'|'RATE_LIMIT'|'VALIDATION'|'UNKNOWN'} Error category
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
   * Determine whether an error's classification is retryable.
   * VALIDATION and INSUFFICIENT_FUNDS errors are never retried.
   * @param {Error} error - Error to evaluate
   * @returns {boolean} True if the error should be retried
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
   * Compute the backoff delay for a retry attempt, with up to 30% random jitter.
   * @param {number} attempt - 1-indexed attempt number
   * @returns {number} Delay in ms, capped at `config.maxDelay` before jitter is added
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
   * Get the recorded retry attempt history for a transaction.
   * @param {string} transactionId - Transaction id
   * @returns {Array<{attempt: number, timestamp: Date, error: string, errorType: string}>} Attempts recorded so far (empty if none)
   */
  getRetryAttempts(transactionId) {
    return this.retryAttempts.get(transactionId) || [];
  }

  /**
   * Get aggregate retry and circuit breaker statistics across all tracked transactions.
   * @returns {{totalTransactions: number, circuitBreakerState: string, circuitBreakerFailures: number, retryDistribution: Object<number, number>}} Retry stats
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
   * Manually reset the circuit breaker to CLOSED and clear its failure count. Emits `circuitBreakerReset`.
   * @returns {void}
   */
  resetCircuitBreaker() {
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.state = 'CLOSED';
    this.circuitBreaker.lastFailureTime = null;
    this.emit('circuitBreakerReset');
  }

  /**
   * Clear retry history for one transaction, or all transactions if none is given.
   * @param {string|null} [transactionId=null] - Transaction id to clear, or null to clear all
   * @returns {void}
   */
  clearRetryHistory(transactionId = null) {
    if (transactionId) {
      this.retryAttempts.delete(transactionId);
    } else {
      this.retryAttempts.clear();
    }
  }

  /**
   * Resolve after a delay.
   * @param {number} ms - Delay in milliseconds
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default TransactionRetryService;
