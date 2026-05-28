/**
 * Transaction Service
 * Handles fetching, caching, and managing transaction history from Stellar Horizon API
 */

import * as StellarSDK from '@stellar/stellar-sdk';
import { MultiLevelCache } from '../cache/multi-level.js';
import { eventMonitor } from '../eventSourcing/index.js';
import logger from '../config/logger.js';
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
   * Fetch transactions for an account with pagination and filtering
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
      logger.debug('Transaction cache hit', { accountId, count: transactions.length });
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

      logger.info('Fetched transactions from Horizon', {
        accountId,
        count: enrichedTransactions.length,
        cursor,
        limit
      });

      return enrichedTransactions;
    } catch (error) {
      logger.error('Failed to fetch transactions', { accountId, error: error.message });
      throw error;
    }
  }

  /**
   * Search transactions by various criteria
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
   * Get transaction analytics
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
   * Start real-time transaction monitoring for an account
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
   * Stop monitoring an account
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
   * Check for new transactions across monitored accounts
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
   * Get the latest transaction for an account
   */
  async getLatestTransaction(accountId) {
    const transactions = await this.getTransactions(accountId, { limit: 1 });
    return transactions[0] || null;
  }

  /**
   * Enrich transaction with additional data
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
   * Get operations for a transaction
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
   * Check if transaction involves a specific asset
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
   * Calculate analytics from transactions
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
   * Store transactions in event store for persistence
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

export const transactionService = new TransactionService();