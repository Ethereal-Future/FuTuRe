'use strict';

/**
 * Horizon ledger ingestion service.
 *
 * Polls the Horizon `/ledgers` endpoint to process newly closed ledgers.
 * All HTTP requests are wrapped in a retry interceptor (exponential backoff
 * with jitter) and guarded by a circuit breaker. On consecutive timeouts the
 * service fails over to configured secondary Horizon nodes. Errors are caught
 * at the worker-loop level so the process survives 504 Gateway Timeouts.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

/**
 * Minimal circuit breaker implementation.
 *
 * States: CLOSED -> OPEN (after `failureThreshold` consecutive failures)
 *         OPEN -> HALF_OPEN (after `resetTimeoutMs`)
 *         HALF_OPEN -> CLOSED (on success) | OPEN (on failure)
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'circuit-breaker';
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts || 1;

    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptAt = 0;
    this.halfOpenAttempts = 0;
  }

  get isOpen() {
    if (this.state === 'OPEN' && Date.now() >= this.nextAttemptAt) {
      this._transition('HALF_OPEN');
    }
    return this.state === 'OPEN';
  }

  _transition(newState) {
    if (this.state === newState) return;
    const previous = this.state;
    this.state = newState;
    if (newState === 'HALF_OPEN') {
      this.halfOpenAttempts = 0;
    }
    if (newState === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
    }
    logger.warn(
      { breaker: this.name, from: previous, to: newState },
      'Circuit breaker state transition'
    );
    if (metrics && typeof metrics.recordCircuitBreakerState === 'function') {
      metrics.recordCircuitBreakerState(this.name, newState);
    }
  }

  /**
   * Throws if the breaker is open and no probe is allowed.
   */
  allowRequest() {
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttemptAt) {
        this._transition('HALF_OPEN');
      } else {
        return false;
      }
    }
    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        return false;
      }
      this.halfOpenAttempts += 1;
    }
    return true;
  }

  recordSuccess() {
    this.successCount += 1;
    if (this.state === 'HALF_OPEN') {
      this._transition('CLOSED');
    } else {
      this.failureCount = 0;
    }
  }

  recordFailure() {
    this.failureCount += 1;
    if (this.state === 'HALF_OPEN') {
      this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
      this._transition('OPEN');
      return;
    }
    if (this.failureCount >= this.failureThreshold) {
      this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
      this._transition('OPEN');
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function isRetryableStatus(statusCode) {
  return RETRYABLE_STATUS_CODES.has(statusCode);
}

function isRetryableError(err) {
  if (!err) return false;
  if (err.code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(err.code)) {
    return true;
  }
  if (err.name === 'TimeoutError') return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with full jitter.
 * delay = random(0, min(cap, base * 2^attempt))
 */
function computeBackoffDelay(attempt, baseMs, capMs) {
  const exponential = Math.min(capMs, baseMs * Math.pow(2, attempt));
  return Math.floor(Math.random() * exponential);
}

/**
 * Perform a single HTTP(S) GET request.
 * Resolves with { statusCode, body } and rejects on network errors/timeouts.
 */
function httpGet(urlString, { timeoutMs = 10000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (err) {
      reject(err);
      return;
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'stellar-horizon-ingestion/1.0',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ statusCode: res.statusCode, body, headers: res.headers });
        });
        res.on('error', reject);
      }
    );

    req.setTimeout(timeoutMs, () => {
      const err = new Error(`Request timed out after ${timeoutMs}ms`);
      err.name = 'TimeoutError';
      err.code = 'ETIMEDOUT';
      req.destroy(err);
    });

    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Horizon ingestion service
// ---------------------------------------------------------------------------

class HorizonIngestionService {
  /**
   * @param {object} options
   * @param {string[]} options.primaryUrls   Primary Horizon node URLs.
   * @param {string[]} [options.secondaryUrls] Fallback Horizon node URLs.
   * @param {number} [options.pollIntervalMs] Delay between ledger polls.
   * @param {number} [options.requestTimeoutMs] Per-request timeout.
   * @param {number} [options.maxRetries] Max retry attempts per request.
   * @param {number} [options.backoffBaseMs] Base backoff delay.
   * @param {number} [options.backoffCapMs] Max backoff delay.
   * @param {number} [options.failoverThreshold] Consecutive timeouts before failover.
   * @param {number} [options.breakerFailureThreshold] Breaker failure threshold.
   * @param {number} [options.breakerResetTimeoutMs] Breaker reset timeout.
   * @param {Function} [options.onLedger] Callback invoked with each new ledger.
   */
  constructor(options = {}) {
    this.primaryUrls = options.primaryUrls || [];
    this.secondaryUrls = options.secondaryUrls || [];
    if (this.primaryUrls.length === 0 && this.secondaryUrls.length === 0) {
      throw new Error('HorizonIngestionService requires at least one Horizon URL');
    }

    this.pollIntervalMs = options.pollIntervalMs || 5000;
    this.requestTimeoutMs = options.requestTimeoutMs || 10000;
    this.maxRetries = options.maxRetries != null ? options.maxRetries : 5;
    this.backoffBaseMs = options.backoffBaseMs || 250;
    this.backoffCapMs = options.backoffCapMs || 15000;
    this.failoverThreshold = options.failoverThreshold || 3;

    this.onLedger = typeof options.onLedger === 'function' ? options.onLedger : null;

    this.breakers = new Map();
    const breakerOpts = {
      failureThreshold: options.breakerFailureThreshold || 5,
      resetTimeoutMs: options.breakerResetTimeoutMs || 30000,
    };
    for (const url of [...this.primaryUrls, ...this.secondaryUrls]) {
      this.breakers.set(url, new CircuitBreaker({ name: `horizon:${url}`, ...breakerOpts }));
    }

    this.currentNodeIndex = 0;
    this.consecutiveTimeouts = 0;
    this.lastLedgerSequence = null;
    this.running = false;
    this._loopPromise = null;
    this._stopRequested = false;
  }

  get nodes() {
    return [...this.primaryUrls, ...this.secondaryUrls];
  }

  get currentNode() {
    return this.nodes[this.currentNodeIndex] || this.nodes[0];
  }

  /**
   * Start the ingestion worker loop. Resolves only when stopped.
   */
  start() {
    if (this.running) return this._loopPromise;
    this.running = true;
    this._stopRequested = false;
    this._loopPromise = this._runLoop();
    return this._loopPromise;
  }

  async stop() {
    this._stopRequested = true;
    if (this._loopPromise) {
      try {
        await this._loopPromise;
      } catch (err) {
        logger.error({ err }, 'Error while stopping Horizon ingestion loop');
      }
    }
    this.running = false;
  }

  /**
   * Main worker loop. Catches all errors so the process never crashes on
   * upstream 504s or other transient failures.
   */
  async _runLoop() {
    logger.info({ nodes: this.nodes }, 'Horizon ledger ingestion worker started');

    while (!this._stopRequested) {
      try {
        await this._pollOnce();
      } catch (err) {
        // Defensive catch: the loop must survive any error.
        logger.error({ err }, 'Unhandled error in Horizon ingestion loop iteration');
        if (metrics && typeof metrics.increment === 'function') {
          metrics.increment('horizon.ingestion.loop_error');
        }
      }

      if (this._stopRequested) break;

      try {
        await sleep(this.pollIntervalMs);
      } catch (err) {
        // sleep should never throw, but guard anyway.
        logger.error({ err }, 'Error during ingestion poll sleep');
      }
    }

    logger.info('Horizon ledger ingestion worker stopped');
  }

  /**
   * Perform a single poll iteration across candidate nodes.
   */
  async _pollOnce() {
    const path = this._buildLedgersPath();
    const orderedNodes = this._orderedNodes();

    let lastError = null;
    for (const node of orderedNodes) {
      const breaker = this.breakers.get(node);
      if (breaker && !breaker.allowRequest()) {
        logger.warn({ node }, 'Circuit breaker open; skipping Horizon node');
        if (metrics && typeof metrics.increment === 'function') {
          metrics.increment('horizon.ingestion.breaker_skipped');
        }
        continue;
      }

      try {
        const response = await this._requestWithRetry(node, path, breaker);
        this._handleLedgersResponse(response);
        this.consecutiveTimeouts = 0;
        return;
      } catch (err) {
        lastError = err;
        if (this._isTimeout(err)) {
          this.consecutiveTimeouts += 1;
          if (metrics && typeof metrics.increment === 'function') {
            metrics.increment('horizon.ingestion.timeout');
          }
          if (this.consecutiveTimeouts >= this.failoverThreshold) {
            this._failover(node);
          }
        } else {
          logger.warn({ err, node }, 'Horizon request failed');
        }
      }
    }

    if (lastError) {
      logger.error(
        { err: lastError, consecutiveTimeouts: this.consecutiveTimeouts },
        'All Horizon nodes failed for ledger poll'
      );
    }
  }

  _buildLedgersPath() {
    const params = new URLSearchParams();
    params.set('order', 'asc');
    params.set('limit', '10');
    if (this.lastLedgerSequence != null) {
      params.set('cursor', String(this.lastLedgerSequence));
    }
    return `/ledgers?${params.toString()}`;
  }

  _orderedNodes() {
    // Start from the current node, then rotate through the rest.
    const nodes = this.nodes;
    if (nodes.length === 0) return [];
    const start = this.currentNodeIndex % nodes.length;
    return [...nodes.slice(start), ...nodes.slice(0, start)];
  }

  _isTimeout(err) {
    if (!err) return false;
    if (err.name === 'TimeoutError') return true;
    if (err.code === 'ETIMEDOUT') return true;
    if (err.statusCode === 504) return true;
    return false;
  }

  _failover(failedNode) {
    const nodes = this.nodes;
    if (nodes.length <= 1) {
      logger.warn({ node: failedNode }, 'Consecutive timeouts but no secondary Horizon nodes configured');
      return;
    }
    const currentIdx = nodes.indexOf(failedNode);
    const nextIdx = (currentIdx + 1) % nodes.length;
    if (nextIdx !== this.currentNodeIndex) {
      const previous = this.currentNode;
      this.currentNodeIndex = nextIdx;
      this.consecutiveTimeouts = 0;
      logger.warn(
        { from: previous, to: this.currentNode, reason: 'consecutive_timeouts' },
        'Failing over to secondary Horizon node'
      );
      if (metrics && typeof metrics.increment === 'function') {
        metrics.increment('horizon.ingestion.failover');
      }
    }
  }

  /**
   * Request with exponential backoff + jitter, honoring the circuit breaker.
   */
  async _requestWithRetry(node, path, breaker) {
    const url = `${node.replace(/\/$/, '')}${path}`;
    let attempt = 0;
    let lastError = null;

    while (attempt <= this.maxRetries) {
      if (breaker && !breaker.allowRequest()) {
        const err = new Error('Circuit breaker open');
        err.name = 'CircuitBreakerOpenError';
        err.code = 'ECIRCUITOPEN';
        throw err;
      }

      try {
        const response = await httpGet(url, { timeoutMs: this.requestTimeoutMs });

        if (response.statusCode >= 200 && response.statusCode < 300) {
          if (breaker) breaker.recordSuccess();
          return response;
        }

        const statusErr = new Error(`Horizon responded with status ${response.statusCode}`);
        statusErr.statusCode = response.statusCode;
        statusErr.body = response.body;

        if (isRetryableStatus(response.statusCode)) {
          if (breaker) breaker.recordFailure();
          lastError = statusErr;
          logger.warn(
            { node, statusCode: response.statusCode, attempt },
            'Retryable Horizon response'
          );
          if (metrics && typeof metrics.increment === 'function') {
            metrics.increment('horizon.ingestion.retry');
          }
        } else {
          // Non-retryable client error: do not trip breaker, surface immediately.
          throw statusErr;
        }
      } catch (err) {
        if (err.name === 'CircuitBreakerOpenError') throw err;

        if (err.statusCode && !isRetryableStatus(err.statusCode)) {
          throw err;
        }

        if (breaker) breaker.recordFailure();
        lastError = err;

        if (!isRetryableError(err) && !err.statusCode) {
          // Unknown non-retryable error.
          throw err;
        }

        logger.warn({ err, node, attempt }, 'Horizon request failed; will retry');
        if (metrics && typeof metrics.increment === 'function') {
          metrics.increment('horizon.ingestion.retry');
        }
      }

      if (attempt >= this.maxRetries) break;

      const delay = computeBackoffDelay(attempt, this.backoffBaseMs, this.backoffCapMs);
      logger.debug({ node, attempt, delay }, 'Backing off before Horizon retry');
      await sleep(delay);
      attempt += 1;
    }

    if (lastError) throw lastError;
    throw new Error('Horizon request failed after retries');
  }

  _handleLedgersResponse(response) {
    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch (err) {
      logger.error({ err }, 'Failed to parse Horizon /ledgers response');
      return;
    }

    const records = Array.isArray(payload && payload._embedded && payload._embedded.records)
      ? payload._embedded.records
      : Array.isArray(payload)
      ? payload
      : [];

    for (const ledger of records) {
      const seq = ledger && ledger.sequence != null ? Number(ledger.sequence) : null;
      if (seq == null) continue;
      if (this.lastLedgerSequence != null && seq <= this.lastLedgerSequence) continue;

      this.lastLedgerSequence = seq;

      if (metrics && typeof metrics.increment === 'function') {
        metrics.increment('horizon.ingestion.ledger_processed');
      }

      if (this.onLedger) {
        try {
          this.onLedger(ledger);
        } catch (err) {
          logger.error({ err, sequence: seq }, 'Error in onLedger callback');
        }
      }
    }
  }
}

module.exports = {
  HorizonIngestionService,
  CircuitBreaker,
  computeBackoffDelay,
  isRetryableStatus,
  isRetryableError,
};