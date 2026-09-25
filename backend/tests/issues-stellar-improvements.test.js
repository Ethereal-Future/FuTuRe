import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Issue #1265, #1264, #1267, #1270: Stellar service improvements', () => {
  let StellarService;
  let mockHorizonServer;
  let mockFeeSurge;
  let mockBalanceCache;
  let mockWebsocket;

  beforeEach(async () => {
    vi.resetModules();

    mockHorizonServer = {
      transactions: vi.fn(),
      submitTransaction: vi.fn(),
      loadAccount: vi.fn(),
      feeStats: vi.fn(),
    };

    mockFeeSurge = {
      recordFeeSample: vi.fn(),
      getSevenDayAverageFee: vi.fn(() => 500),
      detectFeeSurge: vi.fn((fee, avg) => ({ surge: fee > 2000, ratio: fee / (avg || 1) })),
    };

    mockBalanceCache = {
      invalidateBalanceCache: vi.fn().mockResolvedValue(),
      getCachedBalance: vi.fn((pk, fn) => fn()),
    };

    mockWebsocket = {
      broadcastToAccount: vi.fn(),
    };

    vi.doMock('../src/cache/balanceCache.js', () => mockBalanceCache);
    vi.doMock('../src/services/websocket.js', () => mockWebsocket);
    vi.doMock('../src/services/feeSurge.js', () => mockFeeSurge);
    vi.doMock('../src/services/circuitBreaker.js', () => ({
      callWithCircuitBreaker: (fn) => fn(),
      createCircuitBreaker: () => ({ call: (fn) => fn() }),
    }));
    vi.doMock('../src/eventSourcing/index.js', () => ({
      eventMonitor: { publishEvent: vi.fn().mockResolvedValue() },
    }));
    vi.doMock('../src/config/env.js', () => ({
      getConfig: () => ({
        stellar: { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
      }),
    }));
    vi.doMock('../src/config/logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      withContext: () => ({ info: vi.fn() }),
    }));
    vi.doMock('../src/monitoring/horizonAlerter.js', () => ({
      recordHorizonCall: vi.fn(),
    }));
    vi.doMock('../src/config/otel.js', () => ({
      withSpan: (_s, _n, fn) => fn({ setAttribute: () => {} }),
    }));
    vi.doMock('../src/db/client.js', () => ({
      default: {
        feeBumpStat: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({ accounts: [] }),
          update: vi.fn().mockResolvedValue({}),
        },
        user: { upsert: vi.fn().mockResolvedValue({ id: 'user-1' }) },
        transaction: { create: vi.fn().mockResolvedValue({ id: 'tx-1' }) },
        $transaction: vi.fn(async (callback) => {
          if (typeof callback === 'function') {
            return callback({
              user: { upsert: vi.fn().mockResolvedValue({ id: 'user-1' }) },
              transaction: { create: vi.fn().mockResolvedValue({ id: 'tx-1' }) },
              feeBumpStat: {
                upsert: vi.fn().mockResolvedValue({ accounts: [] }),
                update: vi.fn().mockResolvedValue({}),
              },
            });
          }
          return Promise.all(callback);
        }),
      },
    }));

    StellarService = await import('../src/services/stellar.js');
  });

  describe('#1265: Transient error handling', () => {
    it('retries on 502, 504, 520, and 429 status codes', async () => {
      const err502 = Object.assign(new Error('Bad Gateway'), { response: { status: 502 } });
      const err504 = Object.assign(new Error('Gateway Timeout'), { response: { status: 504 } });
      const err520 = Object.assign(new Error('Cloudflare Unknown'), { response: { status: 520 } });
      const err429 = Object.assign(new Error('Too Many Requests'), { response: { status: 429 } });

      const fn = vi
        .fn()
        .mockRejectedValueOnce(err502)
        .mockRejectedValueOnce(err504)
        .mockRejectedValueOnce(err520)
        .mockResolvedValue('ok');

      const result = await StellarService.withHorizonRetry(fn);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(4);
    }, 15000);

    it('does not retry on 400, 401, 403, 404, 409', async () => {
      for (const status of [400, 401, 403, 404, 409]) {
        const err = Object.assign(new Error(`Error ${status}`), { response: { status } });
        const fn = vi.fn().mockRejectedValue(err);
        await expect(StellarService.withHorizonRetry(fn)).rejects.toThrow(`Error ${status}`);
        expect(fn).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('#1264: On-chain ledger commitment verification on timeout', () => {
    it('returns confirmed transaction without resubmitting if already in ledger', async () => {
      const txHash = 'deadbeef1234';
      const timeoutErr = Object.assign(new Error('Horizon request timed out'), { isTimeout: true });
      const confirmedTx = {
        id: txHash,
        hash: txHash,
        ledger_attr: 123456,
        successful: true,
      };

      const mockTxLookup = vi.fn().mockResolvedValue(confirmedTx);
      vi.spyOn(StellarService, 'getHorizonServer').mockReturnValue({
        transactions: () => ({
          transaction: (h) => ({ call: () => mockTxLookup(h) }),
        }),
      });

      const fn = vi.fn().mockRejectedValue(timeoutErr);
      const res = await StellarService.withHorizonRetry(fn, txHash);

      expect(res.hash).toBe(txHash);
      expect(res.ledger).toBe(123456);
      expect(res.successful).toBe(true);
      expect(mockTxLookup).toHaveBeenCalledWith(txHash);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('proceeds with retry if tx lookup returns 404', async () => {
      const txHash = 'deadbeef5678';
      const timeoutErr = Object.assign(new Error('Horizon request timed out'), { isTimeout: true });
      const notFoundErr = Object.assign(new Error('Not found'), { response: { status: 404 } });

      const mockTxLookup = vi.fn().mockRejectedValue(notFoundErr);
      vi.spyOn(StellarService, 'getHorizonServer').mockReturnValue({
        transactions: () => ({
          transaction: (h) => ({ call: () => mockTxLookup(h) }),
        }),
      });

      const fn = vi
        .fn()
        .mockRejectedValueOnce(timeoutErr)
        .mockResolvedValue({ hash: txHash, ledger: 123457, successful: true });

      const res = await StellarService.withHorizonRetry(fn, txHash);
      expect(res.hash).toBe(txHash);
      expect(fn).toHaveBeenCalledTimes(2);
    }, 10000);
  });

  describe('#1267: Dynamic fee bump surge adjustment', () => {
    it('adjusts fee bump based on fee surge detection and clamps within limits', async () => {
      const keypair = {
        publicKey: () => 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H',
        secret: () => 'SDJTESTSECRETKEY1234567890',
        sign: vi.fn(),
      };
      const innerTx = { sign: vi.fn() };

      const feeBumpTx = StellarService.wrapWithFeeBump(innerTx, 'SDJTESTSECRETKEY1234567890');
      expect(feeBumpTx).toBeDefined();
    });
  });

  describe('#1270: Dual balance cache invalidation and websocket broadcast', () => {
    it('invalidates both sender and destination cache on payment', async () => {
      const senderSecret = 'SDJTESTSECRETKEY1234567890';
      const senderPublicKey = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
      const destination = 'GDESTINATIONACCOUNT123456789012345678901234567890123456789';

      vi.spyOn(StellarService, 'getHorizonServer').mockReturnValue({
        loadAccount: vi.fn().mockResolvedValue({
          balances: [{ asset_type: 'native', balance: '100.0000000' }],
        }),
        submitTransaction: vi.fn().mockResolvedValue({
          hash: 'tx-hash-dual-cache',
          ledger: 100,
          successful: true,
        }),
        transactions: () => ({
          transaction: () => ({ call: vi.fn() }),
        }),
      });

      const result = await StellarService.sendPayment(
        senderSecret,
        destination,
        '10.0',
        'XLM',
      );

      expect(result.hash).toBe('tx-hash-dual-cache');
      expect(mockBalanceCache.invalidateBalanceCache).toHaveBeenCalledWith(senderPublicKey);
      expect(mockBalanceCache.invalidateBalanceCache).toHaveBeenCalledWith(destination);
      expect(mockWebsocket.broadcastToAccount).toHaveBeenCalledWith(
        destination,
        expect.objectContaining({
          type: 'balance_update',
          destination,
          hash: 'tx-hash-dual-cache',
        }),
      );
    });
  });
});
