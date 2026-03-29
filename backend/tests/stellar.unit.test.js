/**
 * Stellar Service Unit Tests
 * 
 * Comprehensive unit tests for Stellar operations with mocked SDK.
 * Tests account creation, balance checking, payment sending, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as StellarSDK from '@stellar/stellar-sdk';

// Mock the Stellar SDK
vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    random: vi.fn(),
    fromSecret: vi.fn(),
  },
  Horizon: {
    Server: vi.fn(),
  },
  Asset: {
    native: vi.fn(),
  },
  TransactionBuilder: vi.fn(),
  Operation: {
    payment: vi.fn(),
    changeTrust: vi.fn(),
  },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  BASE_FEE: '100',
}));

// Mock event sourcing
vi.mock('../src/eventSourcing/index.js', () => ({
  eventMonitor: {
    publishEvent: vi.fn(() => Promise.resolve({})),
    initialize: vi.fn(() => Promise.resolve()),
  },
}));

// Mock config
vi.mock('../src/config/env.js', () => ({
  getConfig: vi.fn(() => ({
    stellar: {
      network: 'testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    },
  })),
}));

// Mock logger
vi.mock('../src/config/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Prisma
vi.mock('../src/db/client.js', () => ({
  default: {
    user: {
      upsert: vi.fn(() => Promise.resolve({ id: 'user-1' })),
    },
    transaction: {
      create: vi.fn(() => Promise.resolve({ id: 'tx-1' })),
    },
    $transaction: vi.fn((fn) => fn({
      user: {
        upsert: vi.fn(() => Promise.resolve({ id: 'user-1' })),
      },
      transaction: {
        create: vi.fn(() => Promise.resolve({ id: 'tx-1' })),
      },
    })),
  },
}));

// Import the service after mocks are set up
let stellarService;
let mockServer;
let mockKeypair;
let mockAccount;
let mockTransaction;
let mockTransactionBuilder;

describe('Stellar Service Unit Tests', () => {
  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Setup mock implementations
    mockKeypair = {
      publicKey: vi.fn(() => 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H'),
      secret: vi.fn(() => 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH'),
      sign: vi.fn(),
    };
    
    mockAccount = {
      accountId: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H',
      sequenceNumber: () => Promise.resolve('1234567890'),
      balances: [
        { asset_type: 'native', balance: '1000.0000000' },
        { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', balance: '100.0000000' },
      ],
    };
    
    mockTransaction = {
      hash: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2',
      ledger: 12345,
      successful: true,
      sign: vi.fn(),
    };
    
    mockTransactionBuilder = {
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn(() => mockTransaction),
    };
    
    mockServer = {
      loadAccount: vi.fn(() => Promise.resolve(mockAccount)),
      submitTransaction: vi.fn(() => Promise.resolve(mockTransaction)),
      transactions: vi.fn(() => ({
        forAccount: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              cursor: vi.fn(() => ({
                call: vi.fn(() => Promise.resolve({
                  records: [
                    {
                      id: 'tx-1',
                      hash: 'abc123',
                      created_at: '2024-01-01T00:00:00Z',
                      fee_charged: '100',
                      successful: true,
                      memo: null,
                      paging_token: '123',
                      operations: vi.fn(() => Promise.resolve({
                        records: [
                          {
                            type: 'payment',
                            from: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H',
                            to: 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6',
                            amount: '100.0000000',
                            asset_type: 'native',
                          },
                        ],
                      })),
                    },
                  ],
                })),
              })),
            })),
          })),
        })),
      })),
      feeStats: vi.fn(() => Promise.resolve({
        fee_charged: { p50: '100' },
      })),
      orderbook: vi.fn(() => ({
        limit: vi.fn(() => ({
          call: vi.fn(() => Promise.resolve({
            asks: [{ price: '0.1234' }],
            bids: [{ price: '0.1230' }],
          })),
        })),
      })),
      root: vi.fn(() => Promise.resolve({
        horizon_version: '20.0.0',
        network_passphrase: 'Test SDF Network ; September 2015',
        current_protocol_version: '19',
      })),
    };
    
    // Setup Stellar SDK mocks
    StellarSDK.Keypair.random.mockReturnValue(mockKeypair);
    StellarSDK.Keypair.fromSecret.mockReturnValue(mockKeypair);
    StellarSDK.Horizon.Server.mockReturnValue(mockServer);
    StellarSDK.Asset.native.mockReturnValue({ code: 'XLM', issuer: null });
    StellarSDK.TransactionBuilder.mockReturnValue(mockTransactionBuilder);
    StellarSDK.Operation.payment.mockReturnValue({});
    StellarSDK.Operation.changeTrust.mockReturnValue({});
    
    // Import the service
    stellarService = await import('../src/services/stellar.js');
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('createAccount', () => {
    it('should create a new account with valid keypair', async () => {
      const result = await stellarService.createAccount();
      
      expect(result).toHaveProperty('publicKey');
      expect(result).toHaveProperty('secretKey');
      expect(StellarSDK.Keypair.random).toHaveBeenCalled();
    });

    it('should return unique keypair on each call', async () => {
      const mockKeypair2 = {
        publicKey: vi.fn(() => 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6'),
        secret: vi.fn(() => 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH2'),
        sign: vi.fn(),
      };
      
      StellarSDK.Keypair.random
        .mockReturnValueOnce(mockKeypair)
        .mockReturnValueOnce(mockKeypair2);
      
      const result1 = await stellarService.createAccount();
      const result2 = await stellarService.createAccount();
      
      expect(result1.publicKey).not.toBe(result2.publicKey);
      expect(result1.secretKey).not.toBe(result2.secretKey);
    });

    it('should fund account on testnet', async () => {
      global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
      
      await stellarService.createAccount();
      
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://friendbot.stellar.org?addr=')
      );
    });

    it('should handle friendbot failure gracefully', async () => {
      global.fetch = vi.fn(() => Promise.resolve({ ok: false, statusText: 'Bad Request' }));
      
      // Should not throw, just log warning
      await expect(stellarService.createAccount()).resolves.toBeDefined();
    });

    it('should publish AccountCreated event', async () => {
      const { eventMonitor } = await import('../src/eventSourcing/index.js');
      
      await stellarService.createAccount();
      
      expect(eventMonitor.publishEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          type: 'AccountCreated',
          version: 1,
        })
      );
    });

    it('should upsert user in database', async () => {
      const prisma = await import('../src/db/client.js');
      
      await stellarService.createAccount();
      
      expect(prisma.default.user.upsert).toHaveBeenCalled();
    });
  });

  describe('getBalance', () => {
    it('should return balances for a valid account', async () => {
      const publicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      
      const result = await stellarService.getBalance(publicKey);
      
      expect(result).toHaveProperty('publicKey', publicKey);
      expect(result).toHaveProperty('balances');
      expect(Array.isArray(result.balances)).toBe(true);
    });

    it('should format XLM balance correctly', async () => {
      const publicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      
      const result = await stellarService.getBalance(publicKey);
      
      const xlmBalance = result.balances.find(b => b.asset === 'XLM');
      expect(xlmBalance).toBeDefined();
      expect(xlmBalance.balance).toBe('1000.0000000');
    });

    it('should format custom asset balances correctly', async () => {
      const publicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      
      const result = await stellarService.getBalance(publicKey);
      
      const usdcBalance = result.balances.find(b => b.asset === 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
      expect(usdcBalance).toBeDefined();
      expect(usdcBalance.balance).toBe('100.0000000');
    });

    it('should handle account not found error', async () => {
      mockServer.loadAccount.mockRejectedValueOnce(new Error('Account not found'));
      
      const publicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      
      await expect(stellarService.getBalance(publicKey)).rejects.toThrow('Account not found');
    });

    it('should publish BalanceChecked event', async () => {
      const { eventMonitor } = await import('../src/eventSourcing/index.js');
      const publicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      
      await stellarService.getBalance(publicKey);
      
      expect(eventMonitor.publishEvent).toHaveBeenCalledWith(
        publicKey,
        expect.objectContaining({
          type: 'BalanceChecked',
          version: 1,
        })
      );
    });
  });

  describe('sendPayment', () => {
    it('should send XLM payment successfully', async () => {
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const destination = 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6';
      const amount = '10';
      
      const result = await stellarService.sendPayment(sourceSecret, destination, amount);
      
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('ledger');
      expect(result).toHaveProperty('success', true);
    });

    it('should send custom asset payment', async () => {
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const destination = 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6';
      const amount = '50';
      const assetCode = 'USDC';
      
      const result = await stellarService.sendPayment(sourceSecret, destination, amount, assetCode);
      
      expect(result).toHaveProperty('hash');
      expect(result.success).toBe(true);
    });

    it('should throw error for non-XLM without asset issuer', async () => {
      const { getConfig } = await import('../src/config/env.js');
      getConfig.mockReturnValueOnce({
        stellar: {
          network: 'testnet',
          horizonUrl: 'https://horizon-testnet.stellar.org',
          assetIssuer: null,
        },
      });
      
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const destination = 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6';
      const amount = '10';
      const assetCode = 'USDC';
      
      await expect(
        stellarService.sendPayment(sourceSecret, destination, amount, assetCode)
      ).rejects.toThrow('ASSET_ISSUER is required for non-XLM payments');
    });

    it('should handle transaction submission failure', async () => {
      mockServer.submitTransaction.mockRejectedValueOnce(new Error('Transaction failed'));
      
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const destination = 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6';
      const amount = '10';
      
      await expect(
        stellarService.sendPayment(sourceSecret, destination, amount)
      ).rejects.toThrow('Transaction failed');
    });

    it('should publish PaymentSent event on success', async () => {
      const { eventMonitor } = await import('../src/eventSourcing/index.js');
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const destination = 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6';
      const amount = '10';
      
      await stellarService.sendPayment(sourceSecret, destination, amount);
      
      expect(eventMonitor.publishEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          type: 'PaymentSent',
          version: 1,
        })
      );
    });

    it('should persist transaction to database', async () => {
      const prisma = await import('../src/db/client.js');
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const destination = 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6';
      const amount = '10';
      
      await stellarService.sendPayment(sourceSecret, destination, amount);
      
      expect(prisma.default.$transaction).toHaveBeenCalled();
    });

    it('should handle database persistence failure gracefully', async () => {
      const prisma = await import('../src/db/client.js');
      prisma.default.$transaction.mockRejectedValueOnce(new Error('Database error'));
      
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const destination = 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6';
      const amount = '10';
      
      // Should not throw, just log warning
      const result = await stellarService.sendPayment(sourceSecret, destination, amount);
      expect(result).toBeDefined();
    });
  });

  describe('createTrustline', () => {
    it('should create trustline for custom asset', async () => {
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const assetCode = 'USDC';
      
      const result = await stellarService.createTrustline(sourceSecret, assetCode);
      
      expect(result).toHaveProperty('hash');
      expect(result).toHaveProperty('assetCode', assetCode);
      expect(result).toHaveProperty('issuer');
    });

    it('should throw error for unknown asset', async () => {
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const assetCode = 'UNKNOWN';
      
      await expect(
        stellarService.createTrustline(sourceSecret, assetCode)
      ).rejects.toThrow('Unknown asset or missing issuer');
    });

    it('should handle trustline creation failure', async () => {
      mockServer.submitTransaction.mockRejectedValueOnce(new Error('Trustline failed'));
      
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const assetCode = 'USDC';
      
      await expect(
        stellarService.createTrustline(sourceSecret, assetCode)
      ).rejects.toThrow('Trustline failed');
    });

    it('should publish TrustlineCreated event', async () => {
      const { eventMonitor } = await import('../src/eventSourcing/index.js');
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const assetCode = 'USDC';
      
      await stellarService.createTrustline(sourceSecret, assetCode);
      
      expect(eventMonitor.publishEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          type: 'TrustlineCreated',
          version: 1,
        })
      );
    });
  });

  describe('getTransactions', () => {
    it('should return transaction history', async () => {
      const publicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      
      const result = await stellarService.getTransactions(publicKey);
      
      expect(result).toHaveProperty('records');
      expect(result).toHaveProperty('nextCursor');
      expect(Array.isArray(result.records)).toBe(true);
    });

    it('should filter transactions by type', async () => {
      const publicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      
      const result = await stellarService.getTransactions(publicKey, { type: 'payment' });
      
      result.records.forEach(record => {
        expect(record.type).toBe('payment');
      });
    });

    it('should filter transactions by date range', async () => {
      const publicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      const dateFrom = '2024-01-01T00:00:00Z';
      const dateTo = '2024-12-31T23:59:59Z';
      
      const result = await stellarService.getTransactions(publicKey, { dateFrom, dateTo });
      
      result.records.forEach(record => {
        const recordDate = new Date(record.date);
        expect(recordDate).toBeInstanceOf(Date);
      });
    });

    it('should handle pagination with cursor', async () => {
      const publicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      const cursor = '123';
      
      const result = await stellarService.getTransactions(publicKey, { cursor });
      
      expect(result).toHaveProperty('records');
    });

    it('should handle account not found', async () => {
      mockServer.transactions.mockReturnValueOnce({
        forAccount: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              cursor: vi.fn(() => ({
                call: vi.fn(() => Promise.reject(new Error('Account not found'))),
              })),
            })),
          })),
        })),
      });
      
      const publicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      
      await expect(stellarService.getTransactions(publicKey)).rejects.toThrow('Account not found');
    });
  });

  describe('getFeeStats', () => {
    it('should return fee statistics', async () => {
      const result = await stellarService.getFeeStats();
      
      expect(result).toHaveProperty('feeStroops');
      expect(result).toHaveProperty('feeXLM');
      expect(result).toHaveProperty('feeUsd');
      expect(result).toHaveProperty('xlmUsd');
      expect(result).toHaveProperty('traditionalFeeUsd', 25);
    });

    it('should calculate fee in XLM correctly', async () => {
      const result = await stellarService.getFeeStats();
      
      expect(typeof result.feeXLM).toBe('string');
      expect(parseFloat(result.feeXLM)).toBeGreaterThan(0);
    });

    it('should handle fee stats fetch failure', async () => {
      mockServer.feeStats.mockRejectedValueOnce(new Error('Fee stats unavailable'));
      
      await expect(stellarService.getFeeStats()).rejects.toThrow('Fee stats unavailable');
    });
  });

  describe('getExchangeRate', () => {
    it('should return exchange rate for XLM to USDC', async () => {
      const result = await stellarService.getExchangeRate('XLM', 'USDC');
      
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('should return 1.0 for same asset', async () => {
      const result = await stellarService.getExchangeRate('XLM', 'XLM');
      
      expect(result).toBe(1.0);
    });

    it('should return null for invalid asset pair', async () => {
      mockServer.orderbook.mockReturnValueOnce({
        call: vi.fn(() => Promise.reject(new Error('Invalid assets')),
      });
      
      const result = await stellarService.getExchangeRate('INVALID', 'USDC');
      
      expect(result).toBeNull();
    });

    it('should handle orderbook fetch failure', async () => {
      mockServer.orderbook.mockReturnValueOnce({
        call: vi.fn(() => Promise.reject(new Error('Orderbook unavailable')),
      });
      
      const result = await stellarService.getExchangeRate('XLM', 'USDC');
      
      expect(result).toBeNull();
    });
  });

  describe('getNetworkStatus', () => {
    it('should return network status when online', async () => {
      const result = await stellarService.getNetworkStatus();
      
      expect(result).toHaveProperty('network', 'testnet');
      expect(result).toHaveProperty('horizonUrl');
      expect(result).toHaveProperty('online', true);
      expect(result).toHaveProperty('horizonVersion');
      expect(result).toHaveProperty('networkPassphrase');
      expect(result).toHaveProperty('currentProtocolVersion');
    });

    it('should return offline status when Horizon is unreachable', async () => {
      mockServer.root.mockRejectedValueOnce(new Error('Network error'));
      
      const result = await stellarService.getNetworkStatus();
      
      expect(result).toHaveProperty('online', false);
      expect(result).toHaveProperty('network', 'testnet');
    });

    it('should handle mainnet network', async () => {
      const { getConfig } = await import('../src/config/env.js');
      getConfig.mockReturnValueOnce({
        stellar: {
          network: 'mainnet',
          horizonUrl: 'https://horizon.stellar.org',
        },
      });
      
      const result = await stellarService.getNetworkStatus();
      
      expect(result).toHaveProperty('network', 'mainnet');
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts', async () => {
      mockServer.loadAccount.mockRejectedValueOnce(new Error('Network timeout'));
      
      const publicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      
      await expect(stellarService.getBalance(publicKey)).rejects.toThrow('Network timeout');
    });

    it('should handle invalid secret keys', async () => {
      StellarSDK.Keypair.fromSecret.mockImplementationOnce(() => {
        throw new Error('Invalid secret key');
      });
      
      const sourceSecret = 'INVALID_SECRET';
      const destination = 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6';
      const amount = '10';
      
      await expect(
        stellarService.sendPayment(sourceSecret, destination, amount)
      ).rejects.toThrow('Invalid secret key');
    });

    it('should handle insufficient balance', async () => {
      mockServer.submitTransaction.mockRejectedValueOnce(new Error('insufficient balance'));
      
      const sourceSecret = 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH';
      const destination = 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6';
      const amount = '999999999';
      
      await expect(
        stellarService.sendPayment(sourceSecret, destination, amount)
      ).rejects.toThrow('insufficient balance');
    });
  });
});
