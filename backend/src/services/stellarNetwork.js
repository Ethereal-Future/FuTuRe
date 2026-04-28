import * as StellarSDK from '@stellar/stellar-sdk';
import { getConfig } from '../config/env.js';
import logger from '../config/logger.js';
import { createStellarError, ErrorCodes } from '../middleware/errorHandler.js';

/**
 * Connection pool for Horizon servers
 */
class ConnectionPool {
  constructor(maxConnections = 5) {
    this.maxConnections = maxConnections;
    this.connections = new Map();
    this.inUse = new Map();
  }

  getConnection(url) {
    if (!this.connections.has(url)) {
      this.connections.set(url, []);
      this.inUse.set(url, new Set());
    }

    const available = this.connections.get(url);
    const inUseSet = this.inUse.get(url);

    // Reuse existing connection if available
    if (available.length > 0) {
      const conn = available.pop();
      inUseSet.add(conn);
      return conn;
    }

    // Create new connection if under limit
    if (inUseSet.size < this.maxConnections) {
      const conn = new StellarSDK.Horizon.Server(url);
      inUseSet.add(conn);
      return conn;
    }

    throw new Error(`Connection pool exhausted for ${url}`);
  }

  releaseConnection(url, conn) {
    const inUseSet = this.inUse.get(url);
    if (inUseSet && inUseSet.has(conn)) {
      inUseSet.delete(conn);
      const available = this.connections.get(url);
      available.push(conn);
    }
  }

  getStats() {
    const stats = {};
    for (const [url, inUseSet] of this.inUse.entries()) {
      const available = this.connections.get(url) || [];
      stats[url] = {
        total: inUseSet.size + available.length,
        inUse: inUseSet.size,
        available: available.length,
      };
    }
    return stats;
  }
}

/**
 * Retry configuration
 */
const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'],
};

/**
 * Network operation cache
 */
class NetworkCache {
  constructor(ttlMs = 30000) {
    this.cache = new Map();
    this.ttlMs = ttlMs;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys()),
    };
  }
}

/**
 * Network performance metrics
 */
class NetworkMetrics {
  constructor() {
    this.metrics = {
      requests: 0,
      successes: 0,
      failures: 0,
      retries: 0,
      totalLatency: 0,
      avgLatency: 0,
      lastError: null,
      lastErrorTime: null,
    };
    this.latencyHistory = [];
    this.maxHistorySize = 100;
  }

  recordRequest(latencyMs, success = true) {
    this.metrics.requests++;
    this.metrics.totalLatency += latencyMs;
    this.metrics.avgLatency = this.metrics.totalLatency / this.metrics.requests;

    if (success) {
      this.metrics.successes++;
    } else {
      this.metrics.failures++;
    }

    this.latencyHistory.push(latencyMs);
    if (this.latencyHistory.length > this.maxHistorySize) {
      this.latencyHistory.shift();
    }
  }

  recordRetry() {
    this.metrics.retries++;
  }

  recordError(error) {
    this.metrics.lastError = error.message;
    this.metrics.lastErrorTime = new Date().toISOString();
  }

  getMetrics() {
    const sortedLatencies = [...this.latencyHistory].sort((a, b) => a - b);
    const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] || 0;
    const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0;
    const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] || 0;

    return {
      ...this.metrics,
      successRate: this.metrics.requests > 0 
        ? (this.metrics.successes / this.metrics.requests * 100).toFixed(2) + '%'
        : '0%',
      latency: {
        p50: p50.toFixed(2) + 'ms',
        p95: p95.toFixed(2) + 'ms',
        p99: p99.toFixed(2) + 'ms',
      },
    };
  }

  reset() {
    this.metrics = {
      requests: 0,
      successes: 0,
      failures: 0,
      retries: 0,
      totalLatency: 0,
      avgLatency: 0,
      lastError: null,
      lastErrorTime: null,
    };
    this.latencyHistory = [];
  }
}

/**
 * Stellar Network Abstraction
 */
export class StellarNetwork {
  constructor(options = {}) {
    this.config = getConfig().stellar;
    this.network = this.config.network;
    this.horizonUrl = this.config.horizonUrl;
    
    this.connectionPool = new ConnectionPool(options.maxConnections || 5);
    this.cache = new NetworkCache(options.cacheTtlMs || 30000);
    this.metrics = new NetworkMetrics();
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...options.retryConfig };
    
    this.statusMonitor = null;
    this.statusCheckInterval = options.statusCheckInterval || 60000;
    
    logger.info('StellarNetwork initialized', {
      network: this.network,
      horizonUrl: this.horizonUrl,
    });
  }

  /**
   * Get Horizon server instance
   */
  getServer() {
    return this.connectionPool.getConnection(this.horizonUrl);
  }

  /**
   * Release Horizon server instance
   */
  releaseServer(server) {
    this.connectionPool.releaseConnection(this.horizonUrl, server);
  }

  /**
   * Execute operation with retry logic
   */
  async withRetry(operation, operationName = 'operation') {
    let lastError;
    
    for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const startTime = Date.now();
        const result = await operation();
        const latency = Date.now() - startTime;
        
        this.metrics.recordRequest(latency, true);
        return result;
      } catch (error) {
        lastError = error;
        
        // Check if error is retryable
        const isRetryable = this.retryConfig.retryableErrors.includes(error.code) ||
                          error.message?.includes('timeout') ||
                          error.message?.includes('ECONNREFUSED');
        
        if (!isRetryable || attempt === this.retryConfig.maxRetries) {
          const latency = Date.now() - Date.now();
          this.metrics.recordRequest(latency, false);
          this.metrics.recordError(error);
          throw createStellarError(
            `Stellar ${operationName} failed after ${attempt} attempts`,
            error
          );
        }

        this.metrics.recordRetry();
        
        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
          this.retryConfig.maxDelay
        );

        logger.warn(`Stellar ${operationName} retry`, {
          attempt,
          maxRetries: this.retryConfig.maxRetries,
          delay,
          error: error.message,
        });

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw createStellarError(
      `Stellar ${operationName} failed after ${this.retryConfig.maxRetries} attempts`,
      lastError
    );
  }

  /**
   * Execute cached operation
   */
  async withCache(key, operation, ttlMs = this.cache.ttlMs) {
    const cached = this.cache.get(key);
    if (cached !== null) {
      logger.debug('Cache hit', { key });
      return cached;
    }

    logger.debug('Cache miss', { key });
    const result = await operation();
    this.cache.set(key, result, ttlMs);
    return result;
  }

  /**
   * Switch network (testnet/mainnet)
   */
  async switchNetwork(network) {
    if (network !== 'testnet' && network !== 'mainnet') {
      throw new Error('Network must be "testnet" or "mainnet"');
    }

    const newHorizonUrl = network === 'testnet'
      ? 'https://horizon-testnet.stellar.org'
      : 'https://horizon.stellar.org';

    this.network = network;
    this.horizonUrl = newHorizonUrl;
    this.config.network = network;
    this.config.horizonUrl = newHorizonUrl;

    // Clear cache and metrics
    this.cache.clear();
    this.metrics.reset();

    logger.info('Network switched', {
      network,
      horizonUrl: newHorizonUrl,
    });

    return {
      network,
      horizonUrl: newHorizonUrl,
    };
  }

  /**
   * Get network status
   */
  async getNetworkStatus() {
    try {
      const server = this.getServer();
      const root = await this.withRetry(
        () => server.root(),
        'getNetworkStatus'
      );
      this.releaseServer(server);

      const status = {
        network: this.network,
        horizonUrl: this.horizonUrl,
        online: true,
        horizonVersion: root.horizon_version,
        networkPassphrase: root.network_passphrase,
        currentProtocolVersion: root.current_protocol_version,
        coreVersion: root.core_version,
        ledger: {
          sequence: root.history_latest_ledger,
          closedAt: root.history_latest_ledger_close_time,
        },
      };

      logger.debug('Network status', status);
      return status;
    } catch (error) {
      logger.warn('Network status check failed', { error: error.message });
      return {
        network: this.network,
        horizonUrl: this.horizonUrl,
        online: false,
        error: error.message,
      };
    }
  }

  /**
   * Start network status monitoring
   */
  startStatusMonitoring(callback) {
    if (this.statusMonitor) {
      clearInterval(this.statusMonitor);
    }

    this.statusMonitor = setInterval(async () => {
      const status = await this.getNetworkStatus();
      if (callback) {
        callback(status);
      }
    }, this.statusCheckInterval);

    logger.info('Network status monitoring started', {
      interval: this.statusCheckInterval,
    });
  }

  /**
   * Stop network status monitoring
   */
  stopStatusMonitoring() {
    if (this.statusMonitor) {
      clearInterval(this.statusMonitor);
      this.statusMonitor = null;
      logger.info('Network status monitoring stopped');
    }
  }

  /**
   * Get connection pool stats
   */
  getConnectionStats() {
    return this.connectionPool.getStats();
  }

  /**
   * Get cache stats
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Get network metrics
   */
  getMetrics() {
    return this.metrics.getMetrics();
  }

  /**
   * Get all stats
   */
  getStats() {
    return {
      network: this.network,
      horizonUrl: this.horizonUrl,
      connections: this.getConnectionStats(),
      cache: this.getCacheStats(),
      metrics: this.getMetrics(),
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics.reset();
    logger.info('Metrics reset');
  }

  /**
   * Load account
   */
  async loadAccount(publicKey) {
    const cacheKey = `account:${publicKey}`;
    return this.withCache(cacheKey, async () => {
      const server = this.getServer();
      try {
        const account = await this.withRetry(
          () => server.loadAccount(publicKey),
          'loadAccount'
        );
        return account;
      } finally {
        this.releaseServer(server);
      }
    }, 10000); // Cache for 10 seconds
  }

  /**
   * Submit transaction
   */
  async submitTransaction(transaction) {
    const server = this.getServer();
    try {
      const result = await this.withRetry(
        () => server.submitTransaction(transaction),
        'submitTransaction'
      );
      
      // Clear account cache after transaction
      this.cache.clear();
      
      return result;
    } finally {
      this.releaseServer(server);
    }
  }

  /**
   * Get fee stats
   */
  async getFeeStats() {
    const cacheKey = 'feeStats';
    return this.withCache(cacheKey, async () => {
      const server = this.getServer();
      try {
        const stats = await this.withRetry(
          () => server.feeStats(),
          'getFeeStats'
        );
        return stats;
      } finally {
        this.releaseServer(server);
      }
    }, 30000); // Cache for 30 seconds
  }

  /**
   * Get orderbook
   */
  async getOrderbook(selling, buying, options = {}) {
    const cacheKey = `orderbook:${selling}:${buying}:${JSON.stringify(options)}`;
    return this.withCache(cacheKey, async () => {
      const server = this.getServer();
      try {
        const orderbook = await this.withRetry(
          () => server.orderbook(selling, buying).limit(options.limit || 10).call(),
          'getOrderbook'
        );
        return orderbook;
      } finally {
        this.releaseServer(server);
      }
    }, 5000); // Cache for 5 seconds
  }

  /**
   * Get transactions for account
   */
  async getTransactions(publicKey, options = {}) {
    const server = this.getServer();
    try {
      let builder = server.transactions()
        .forAccount(publicKey)
        .order(options.order || 'desc')
        .limit(options.limit || 10);

      if (options.cursor) {
        builder = builder.cursor(options.cursor);
      }

      const result = await this.withRetry(
        () => builder.call(),
        'getTransactions'
      );

      return result;
    } finally {
      this.releaseServer(server);
    }
  }
}

// Singleton instance
let stellarNetworkInstance = null;

/**
 * Get Stellar network instance
 */
export function getStellarNetwork(options = {}) {
  if (!stellarNetworkInstance) {
    stellarNetworkInstance = new StellarNetwork(options);
  }
  return stellarNetworkInstance;
}

/**
 * Reset Stellar network instance (for testing)
 */
export function resetStellarNetwork() {
  if (stellarNetworkInstance) {
    stellarNetworkInstance.stopStatusMonitoring();
    stellarNetworkInstance = null;
  }
}

export default {
  StellarNetwork,
  getStellarNetwork,
  resetStellarNetwork,
};
