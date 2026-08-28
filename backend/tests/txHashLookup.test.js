/**
 * #1122 — Direct Horizon transaction hash lookup.
 *
 * Regression coverage: a transaction older than the top 50 recent records
 * for an account must still be found when looked up by hash, because the
 * hash lookup goes straight to Horizon's /transactions/{hash} endpoint
 * instead of paginating recent history.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const OLD_TX_HASH = 'a'.repeat(64);
const PUBLIC_KEY = 'GAAAA1234567890123456789012345678901234567890123456789012';
const OTHER_PUBLIC_KEY = 'GBBBB1234567890123456789012345678901234567890123456789012';

function makeHorizonTxRecord({ hash, sourceAccount, operations }) {
  return {
    id: hash,
    hash,
    source_account: sourceAccount,
    created_at: '2020-01-01T00:00:00Z',
    fee_charged: '100',
    successful: true,
    memo: null,
    paging_token: '1',
    ledger_attr: 1,
    envelope_xdr: 'AAAA',
    operations: () => Promise.resolve({ records: operations }),
  };
}

describe('#1122 - getTransactionByHash / getTransactionRecordByHash', () => {
  let StellarService;
  let mockTransactionCall;

  beforeEach(async () => {
    vi.resetModules();
    mockTransactionCall = vi.fn();

    vi.doMock('@stellar/stellar-sdk', () => ({
      Horizon: {
        Server: vi.fn().mockImplementation(() => ({
          transactions: () => ({
            transaction: (hash) => ({ call: () => mockTransactionCall(hash) }),
          }),
        })),
      },
      Keypair: { fromSecret: vi.fn(), random: vi.fn() },
      Asset: Object.assign(vi.fn(), { native: vi.fn() }),
      TransactionBuilder: vi.fn(),
      Operation: { payment: vi.fn(), changeTrust: vi.fn() },
      Networks: { TESTNET: 'testnet', PUBLIC: 'public' },
      BASE_FEE: '100',
    }));

    vi.doMock('../src/config/env.js', () => ({
      getConfig: () => ({
        stellar: { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
      }),
    }));

    vi.doMock('../src/config/logger.js', () => ({
      default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      withContext: () => ({ info: vi.fn() }),
    }));

    vi.doMock('../src/db/client.js', () => ({ default: {} }));
    vi.doMock('../src/eventSourcing/index.js', () => ({
      eventMonitor: { publishEvent: vi.fn(() => Promise.resolve()) },
    }));
    vi.doMock('../src/cache/balanceCache.js', () => ({
      getCachedBalance: vi.fn((_pk, fn) => fn()),
      invalidateBalanceCache: vi.fn(),
    }));
    vi.doMock('../src/monitoring/horizonAlerter.js', () => ({ recordHorizonCall: vi.fn() }));
    vi.doMock('../src/config/otel.js', () => ({ withSpan: (_s, _n, fn) => fn({ setAttribute: () => {} }) }));
    vi.doMock('../src/services/feeSurge.js', () => ({
      recordFeeSample: vi.fn(),
      getSevenDayAverageFee: vi.fn(),
      detectFeeSurge: vi.fn(() => ({ surge: false, ratio: 1 })),
    }));
    vi.doMock('../src/services/circuitBreaker.js', () => ({
      callWithCircuitBreaker: (fn) => fn(),
    }));
    vi.doMock('../src/config/assets.js', () => ({ getIssuer: vi.fn() }));

    StellarService = await import('../src/services/stellar.js');
  });

  it('finds a transaction older than the top-50 recent records via direct hash lookup', async () => {
    // Simulate Horizon successfully resolving a hash that would NOT appear
    // in a `.forAccount(pk).limit(50)` page (e.g. it happened years ago).
    mockTransactionCall.mockResolvedValue(
      makeHorizonTxRecord({
        hash: OLD_TX_HASH,
        sourceAccount: PUBLIC_KEY,
        operations: [{ type: 'payment', from: PUBLIC_KEY, to: OTHER_PUBLIC_KEY, amount: '5.0000000' }],
      }),
    );

    const record = await StellarService.getTransactionRecordByHash(OLD_TX_HASH, PUBLIC_KEY);

    expect(mockTransactionCall).toHaveBeenCalledWith(OLD_TX_HASH);
    expect(record.hash).toBe(OLD_TX_HASH);
    expect(record.direction).toBe('sent');
    expect(record.counterparty).toBe(OTHER_PUBLIC_KEY);
  });

  it('throws notFoundReason "horizon" when Horizon has no matching transaction', async () => {
    const horizonError = new Error('Not Found');
    horizonError.response = { status: 404 };
    mockTransactionCall.mockRejectedValue(horizonError);

    await expect(StellarService.getTransactionRecordByHash(OLD_TX_HASH, PUBLIC_KEY)).rejects.toMatchObject({
      notFoundReason: 'horizon',
    });
  });

  it('throws notFoundReason "account_mismatch" when the transaction does not involve the account', async () => {
    mockTransactionCall.mockResolvedValue(
      makeHorizonTxRecord({
        hash: OLD_TX_HASH,
        sourceAccount: OTHER_PUBLIC_KEY,
        operations: [
          { type: 'payment', from: OTHER_PUBLIC_KEY, to: 'GCCCC1234567890123456789012345678901234567890123456789012' },
        ],
      }),
    );

    await expect(StellarService.getTransactionRecordByHash(OLD_TX_HASH, PUBLIC_KEY)).rejects.toMatchObject({
      notFoundReason: 'account_mismatch',
    });
  });

  it('recognizes involvement via the transaction source account even with no matching operation field', async () => {
    mockTransactionCall.mockResolvedValue(
      makeHorizonTxRecord({
        hash: OLD_TX_HASH,
        sourceAccount: PUBLIC_KEY,
        operations: [{ type: 'set_options', account: PUBLIC_KEY }],
      }),
    );

    const record = await StellarService.getTransactionRecordByHash(OLD_TX_HASH, PUBLIC_KEY);
    expect(record.hash).toBe(OLD_TX_HASH);
  });
});
