import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transactionService } from '../src/services/transactions.js';
import * as StellarSDK from '@stellar/stellar-sdk';

// Mock dependencies
vi.mock('@stellar/stellar-sdk');
vi.mock('../src/cache/multi-level.js');
vi.mock('../src/eventSourcing/index.js');
vi.mock('../src/config/env.js');
vi.mock('../src/config/logger.js');

describe('Transaction Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTransactions', () => {
    it('should fetch transactions from Horizon API', async () => {
      const mockServer = {
        transactions: vi.fn().mockReturnThis(),
        forAccount: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        call: vi.fn().mockResolvedValue({
          records: [
            {
              hash: 'test-hash',
              ledger: 123,
              created_at: '2024-01-01T00:00:00Z',
              successful: true,
              operation_count: 1,
              fee_charged: '100',
              max_fee: '200'
            }
          ]
        })
      };

      StellarSDK.Horizon.Server.mockImplementation(() => mockServer);

      const transactions = await transactionService.getTransactions('GTEST123', { limit: 10 });

      expect(transactions).toHaveLength(1);
      expect(transactions[0].hash).toBe('test-hash');
      expect(mockServer.transactions).toHaveBeenCalled();
      expect(mockServer.forAccount).toHaveBeenCalledWith('GTEST123');
    });

    it('should apply filters correctly', async () => {
      const mockServer = {
        transactions: vi.fn().mockReturnThis(),
        forAccount: vi.fn().mockReturnThis(),
        cursor: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        call: vi.fn().mockResolvedValue({ records: [] })
      };

      StellarSDK.Horizon.Server.mockImplementation(() => mockServer);

      await transactionService.getTransactions('GTEST123', {
        limit: 5,
        cursor: 'test-cursor',
        order: 'asc',
        includeFailed: true
      });

      expect(mockServer.cursor).toHaveBeenCalledWith('test-cursor');
      expect(mockServer.limit).toHaveBeenCalledWith(5);
      expect(mockServer.order).toHaveBeenCalledWith('asc');
    });
  });

  describe('searchTransactions', () => {
    it('should filter transactions by search term', async () => {
      const mockTransactions = [
        { hash: 'abc123', memo: 'test payment', operations: [{ type: 'payment' }] },
        { hash: 'def456', memo: 'other transaction', operations: [{ type: 'create_account' }] }
      ];

      // Mock getTransactions to return our test data
      transactionService.getTransactions = vi.fn().mockResolvedValue(mockTransactions);

      const results = await transactionService.searchTransactions('GTEST123', 'payment');

      expect(results).toHaveLength(1);
      expect(results[0].memo).toBe('test payment');
    });
  });

  describe('getTransactionAnalytics', () => {
    it('should calculate analytics correctly', async () => {
      const mockTransactions = [
        {
          successful: true,
          fee_charged: '100',
          operations: [
            { type: 'payment', amount: '10' },
            { type: 'payment', amount: '20' }
          ]
        },
        {
          successful: false,
          fee_charged: '200',
          operations: [{ type: 'create_account' }]
        }
      ];

      transactionService.getTransactions = vi.fn().mockResolvedValue(mockTransactions);

      const analytics = await transactionService.getTransactionAnalytics('GTEST123', '30d');

      expect(analytics.totalTransactions).toBe(2);
      expect(analytics.successfulTransactions).toBe(1);
      expect(analytics.failedTransactions).toBe(1);
      expect(analytics.totalVolume).toBe(30);
      expect(analytics.operationTypes.payment).toBe(2);
      expect(analytics.operationTypes.create_account).toBe(1);
    });
  });

  describe('startMonitoring and stopMonitoring', () => {
    it('should manage monitoring accounts', () => {
      const accountId = 'GTEST123';

      transactionService.startMonitoring(accountId);
      expect(transactionService.monitoringAccounts.has(accountId)).toBe(true);

      transactionService.stopMonitoring(accountId);
      expect(transactionService.monitoringAccounts.has(accountId)).toBe(false);
    });
  });
});