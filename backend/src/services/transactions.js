/**
 * Transaction Service
 * Handles fetching, caching, and managing transaction history from Stellar Horizon API
 */

import * as StellarSDK from '@stellar/stellar-sdk';
import { MultiLevelCache } from '../cache/multi-level.js';
import { eventMonitor } from '../eventSourcing/index.js';
import logger, { withContext } from '../config/logger.js';
import { getConfig } from '../config/env.js';

const TRANSACTION_CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const MAX_TRANSACTIONS_PER_PAGE = 100;
const TRANSACTION_MONITOR_INTERVAL = 60 * 1000; // 1 minute

class TransactionService {
  constructor() {
    this.cache = new MultiLevelCache({ ttl: TRANSACTION_CACHE_TTL });
    this.horizonServer = null;
    this.monitoringAccounts = new Set();
    this.monitoringInterval = null;
  }

  getHorizonServer() {
    if (!this.horizonServer) {
      const { horizonUrl } = getConfig().stellar;
      this.horizonServer = new StellarSDK.Horizon.Server(horizonUrl);
    }
    return this.horizonServer;
  }

  /**
   * Fetch transactions for an account with pagination and filtering.
   * Results are cached for {@link TRANSACTION_CACHE_TTL} ms.
   * @param {string} accountId - Stellar public key of the account
   * @param {object} [options={}]
   * @param {number} [options.limit=20] - Max records to return (up to {@link MAX_TRANSACTIONS_PER_PAGE})
   * @param {string} [options.cursor] - Paging token for cursor-based pagination
   * @param {'asc'|'desc'} [options.order='desc'] - Sort order
   * @param {boolean} [options.includeFailed=false] - Whether to include failed transactions
   * @param {{code: string, issuer: string}} [options.asset] - Filter to transactions involving this asset
   * @param {string} [options.startTime] - ISO date string lower bound
   * @param {string} [options.endTime] - ISO date string upper bound
   * @returns {Promise<object[]>} Array of enriched transaction records
   * @throws {Error} If the Horizon API call fails
   */
  async getTransactions(accountId, options = {}) {
    const {
      limit = 20,
      cursor,
      order = 'desc',
      includeFailed = false,
      asset,
      startTime,
      endTime
    } = options;

    const cacheKey = `transactions:${accountId}:${JSON.stringify(options)}`;

    // Check cache first
    let transactions = await this.cache.get(cacheKey);
    if (transactions) {
      withContext(logger, { action: 'getTransactions', accountId }).debug('Transaction cache hit', { count: transactions.length });
      return transactions;
    }

    try {
      const server = this.getHorizonServer();
      let builder = server.transactions().forAccount(accountId);

      // Apply filters
      if (cursor) {
        builder = builder.cursor(cursor);
      }

      if (order === 'asc') {
        builder = builder.order('asc');
      }

      if (limit && limit <= MAX_TRANSACTIONS_PER_PAGE) {
        builder = builder.limit(limit);
      }

      const response = await builder.call();

      // Filter transactions based on criteria
      transactions = response.records.filter(tx => {
        if (!includeFailed && tx.successful === false) return false;
        if (asset && !this.transactionInvolvesAsset(tx, asset)) return false;
        if (startTime && new Date(tx.created_at) < new Date(startTime)) return false;
        if (endTime && new Date(tx.created_at) > new Date(endTime)) return false;
        return true;
      });

      // Enrich transactions with additional data
      const enrichedTransactions = await Promise.all(
        transactions.map(tx => this.enrichTransaction(tx))
      );

      // Cache the results
      await this.cache.set(cacheKey, enrichedTransactions);

      // Store in event store for persistence
      await this.storeTransactions(accountId, enrichedTransactions);

      withContext(logger, { action: 'getTransactions', accountId }).info('Fetched transactions from Horizon', {
        count: enrichedTransactions.length,
        cursor,
        limit,
      });

      return enrichedTransactions;
    } catch (error) {
      withContext(logger, { action: 'getTransactions', accountId }).error('Failed to fetch transactions', { error: error.message });
      throw error;
    }
  }

  /**
   * Search transactions by hash, source account, memo, or asset details.
   * Fetches up to 1000 records and filters in-memory.
   * @param {string} accountId - Stellar public key of the account
   * @param {string} searchTerm - Case-insensitive substring to match against transaction fields
   * @param {object} [options={}] - Additional options passed to {@link getTransactions}
   * @returns {Promise<object[]>} Matching enriched transaction records
   */
  async searchTransactions(accountId, searchTerm, options = {}) {
    const transactions = await this.getTransactions(accountId, {
      ...options,
      limit: 1000 // Get more for searching
    });

    const term = searchTerm.toLowerCase();

    return transactions.filter(tx => {
      return (
        tx.hash.toLowerCase().includes(term) ||
        tx.source_account.toLowerCase().includes(term) ||
        (tx.memo && tx.memo.toLowerCase().includes(term)) ||
        tx.operations.some(op =>
          op.type.toLowerCase().includes(term) ||
          (op.asset_code && op.asset_code.toLowerCase().includes(term)) ||
          (op.asset_issuer && op.asset_issuer.toLowerCase().includes(term))
        )
      );
    });
  }

  /**
   * Calculate transaction analytics for an account over a given timeframe.
   * @param {string} accountId - Stellar public key of the account
   * @param {'24h'|'7d'|'30d'|'90d'} [timeframe='30d'] - Lookback window
   * @returns {Promise<{totalTransactions: number, successfulTransactions: number, failedTransactions: number, totalVolume: number, averageFee: number, operationTypes: object, dailyVolume: object, assets: string[]}>}
   */
  async getTransactionAnalytics(accountId, timeframe = '30d') {
    const cacheKey = `analytics:${accountId}:${timeframe}`;

    let analytics = await this.cache.get(cacheKey);
    if (analytics) return analytics;

    const endTime = new Date();
    const startTime = new Date();

    switch (timeframe) {
      case '24h':
        startTime.setHours(startTime.getHours() - 24);
        break;
      case '7d':
        startTime.setDate(startTime.getDate() - 7);
        break;
      case '30d':
        startTime.setDate(startTime.getDate() - 30);
        break;
      case '90d':
        startTime.setDate(startTime.getDate() - 90);
        break;
      default:
        startTime.setDate(startTime.getDate() - 30);
    }

    const transactions = await this.getTransactions(accountId, {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      limit: 1000,
      includeFailed: false
    });

    analytics = this.calculateAnalytics(transactions);
    await this.cache.set(cacheKey, analytics, 15 * 60 * 1000); // 15 min cache

    return analytics;
  }

  /**
   * Start polling for new transactions on an account. Broadcasts via WebSocket on each new transaction.
   * No-op if monitoring is already running for this account.
   * @param {string} accountId - Stellar public key of the account to monitor
   * @returns {void}
   */
  startMonitoring(accountId) {
    this.monitoringAccounts.add(accountId);

    if (!this.monitoringInterval) {
      this.monitoringInterval = setInterval(() => {
        this.checkForNewTransactions();
      }, TRANSACTION_MONITOR_INTERVAL);
    }

    logger.info('Started transaction monitoring', { accountId });
  }

  /**
   * Stop polling for new transactions on an account. Clears the interval when no accounts remain.
   * @param {string} accountId - Stellar public key of the account to stop monitoring
   * @returns {void}
   */
  stopMonitoring(accountId) {
    this.monitoringAccounts.delete(accountId);

    if (this.monitoringAccounts.size === 0 && this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    logger.info('Stopped transaction monitoring', { accountId });
  }

  /**
   * Poll each monitored account for its latest transaction and broadcast it via WebSocket.
   * @returns {Promise<void>}
   */
  async checkForNewTransactions() {
    for (const accountId of this.monitoringAccounts) {
      try {
        const latestTx = await this.getLatestTransaction(accountId);
        if (latestTx) {
          // Broadcast new transaction via WebSocket
          const { broadcastToAccount } = await import('../services/websocket.js');
          broadcastToAccount(accountId, {
            type: 'transaction:new',
            transaction: latestTx,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        logger.error('Error checking for new transactions', { accountId, error: error.message });
      }
    }
  }

  /**
   * Fetch the most recent transaction for an account.
   * @param {string} accountId - Stellar public key of the account
   * @returns {Promise<object|null>} The latest enriched transaction, or null if none
   */
  async getLatestTransaction(accountId) {
    const transactions = await this.getTransactions(accountId, { limit: 1 });
    return transactions[0] || null;
  }

  /**
   * Enrich a raw Horizon transaction record with its operations and status.
   * @param {object} tx - Raw transaction record from Horizon
   * @returns {Promise<object>} Enriched transaction with `operations` and `status` fields
   */
  async enrichTransaction(tx) {
    const enriched = { ...tx };

    // Add operation details
    enriched.operations = await this.getTransactionOperations(tx.hash);

    // Add status information
    enriched.status = tx.successful ? 'successful' : 'failed';

    // Add fee information
    enriched.fee_charged = tx.fee_charged;
    enriched.max_fee = tx.max_fee;

    return enriched;
  }

  /**
   * Fetch all operations for a transaction hash from Horizon.
   * @param {string} txHash - Transaction hash
   * @returns {Promise<object[]>} Array of operation records (empty array on error)
   */
  async getTransactionOperations(txHash) {
    try {
      const server = this.getHorizonServer();
      const response = await server.operations().forTransaction(txHash).call();
      return response.records;
    } catch (error) {
      logger.error('Failed to get transaction operations', { txHash, error: error.message });
      return [];
    }
  }

  /**
   * Check whether any operation in a transaction involves a specific asset.
   * @param {object} tx - Enriched transaction record
   * @param {{code: string, issuer: string}} asset - Asset to match
   * @returns {boolean}
   */
  transactionInvolvesAsset(tx, asset) {
    return tx.operations.some(op => {
      if (op.asset_code === asset.code && op.asset_issuer === asset.issuer) {
        return true;
      }
      return false;
    });
  }

  /**
   * Compute aggregate analytics from an array of enriched transaction records.
   * @param {object[]} transactions - Enriched transaction records
   * @returns {{totalTransactions: number, successfulTransactions: number, failedTransactions: number, totalVolume: number, averageFee: number, operationTypes: object, dailyVolume: object, assets: string[]}}
   */
  calculateAnalytics(transactions) {
    const analytics = {
      totalTransactions: transactions.length,
      successfulTransactions: transactions.filter(tx => tx.successful).length,
      failedTransactions: transactions.filter(tx => !tx.successful).length,
      totalVolume: 0,
      averageFee: 0,
      operationTypes: {},
      dailyVolume: {},
      assets: new Set()
    };

    let totalFee = 0;

    transactions.forEach(tx => {
      // Calculate volume and fees
      totalFee += parseInt(tx.fee_charged) || 0;

      // Count operation types
      tx.operations.forEach(op => {
        analytics.operationTypes[op.type] = (analytics.operationTypes[op.type] || 0) + 1;

        // Track assets
        if (op.asset_code) {
          analytics.assets.add(`${op.asset_code}:${op.asset_issuer}`);
        }

        // Calculate volume for payment operations
        if (op.type === 'payment' && op.amount) {
          analytics.totalVolume += parseFloat(op.amount);
        }
      });

      // Daily volume
      const date = new Date(tx.created_at).toISOString().split('T')[0];
      analytics.dailyVolume[date] = (analytics.dailyVolume[date] || 0) + 1;
    });

    analytics.averageFee = analytics.totalTransactions > 0 ? totalFee / analytics.totalTransactions : 0;
    analytics.assets = Array.from(analytics.assets);

    return analytics;
  }

  /**
   * Persist fetched transactions to the event store for audit and replay purposes.
   * @param {string} accountId - Stellar public key of the account
   * @param {object[]} transactions - Enriched transaction records to persist
   * @returns {Promise<void>}
   */
  async storeTransactions(accountId, transactions) {
    for (const tx of transactions) {
      await eventMonitor.publishEvent(accountId, {
        type: 'TransactionFetched',
        data: {
          hash: tx.hash,
          ledger: tx.ledger,
          created_at: tx.created_at,
          successful: tx.successful,
          operation_count: tx.operation_count,
          fee_charged: tx.fee_charged,
          max_fee: tx.max_fee
        },
        version: 1,
        metadata: { source: 'horizon-api' }
      });
    }
  }
}

/** Singleton {@link TransactionService} instance for use throughout the application. */
export const transactionService = new TransactionService();