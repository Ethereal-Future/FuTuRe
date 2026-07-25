import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transactionService } from '../src/services/transactions.js';
import { eventMonitor } from '../src/eventSourcing/index.js';
import * as StellarSDK from '@stellar/stellar-sdk';

// Mock Stellar SDK Horizon Server
vi.mock('@stellar/stellar-sdk', async () => {
  const actual = await vi.importActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: vi.fn().mockImplementation(() => ({
        transactions: vi.fn().mockReturnThis(),
        forAccount: vi.fn().mockReturnThis(),
        cursor: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        call: vi.fn().mockResolvedValue({
          records: [
            {
              hash: 'test-hash-123',
              ledger: 100,
              created_at: '2026-03-29T00:00:00Z',
              successful: true,
              source_account: 'GABC123',
              fee_charged: '100',
              max_fee: '1000',
              operation_count: 1
            }
          ]
        }),
        operations: vi.fn().mockReturnThis(),
        forTransaction: vi.fn().mockReturnThis(),
      }))
    }
  };
});

describe('Service Integration: TransactionService + Cache + EventMonitor', () => {
  const accountId = 'GABC123';

  beforeEach(async () => {
    // Clear cache and reset mocks
    await transactionService.cache.clear();
    vi.clearAllMocks();
    
    // Ensure event monitor is initialized
    if (!eventMonitor.initialized) {
      await eventMonitor.initialize();
    }
  });

  it('should fetch transactions, cache them, and publish events', async () => {
    // 1. Initial fetch (Cache Miss)
    const txs = await transactionService.getTransactions(accountId);
    
    expect(txs).toHaveLength(1);
    expect(txs[0].hash).toBe('test-hash-123');
    expect(transactionService.cache.getStats().hits).toBe(0);
    expect(transactionService.cache.getStats().misses).toBe(1);

    // 2. Verify Event Publication
    const history = await eventMonitor.getEventHistory(accountId);
    const fetchEvent = history.find(e => e.type === 'TransactionFetched');
    expect(fetchEvent).toBeDefined();
    expect(fetchEvent.data.hash).toBe('test-hash-123');

    // 3. Second fetch (Cache Hit)
    const cachedTxs = await transactionService.getTransactions(accountId);
    expect(cachedTxs).toHaveLength(1);
    expect(transactionService.cache.getStats().hits).toBe(1);
    
    // Verify that Horizon was NOT called again
    const serverInstance = new StellarSDK.Horizon.Server('any');
    expect(serverInstance.transactions).toHaveBeenCalledTimes(1);
  });

  it('should calculate analytics based on fetched transactions', async () => {
    const analytics = await transactionService.getTransactionAnalytics(accountId, '24h');
    
    expect(analytics).toBeDefined();
    expect(analytics.totalTransactions).toBeGreaterThanOrEqual(0);
    expect(analytics.successfulTransactions).toBeDefined();
    expect(analytics.failedTransactions).toBeDefined();
  });
});
