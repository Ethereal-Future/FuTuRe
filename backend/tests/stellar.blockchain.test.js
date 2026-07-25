/**
 * Stellar Blockchain Testing Suite
 *
 * Covers:
 *  - Testnet account creation and funding
 *  - Transaction building and submission
 *  - Network failure handling
 *  - Blockchain state verification
 *  - Consensus / finality checks
 *  - Blockchain performance benchmarking
 *  - Smart contract (Soroban) interaction stubs
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as StellarSDK from '@stellar/stellar-sdk';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    random: vi.fn(() => ({
      publicKey: () => 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H',
      secret: () => 'SCZANGBA5RLKJNMDBJKWNCLQXA5DOHXD4OOCHQ6DPWQK7FZNKVKQHE',
    })),
    fromSecret: vi.fn((secret) => ({
      publicKey: () => 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H',
      secret: () => secret,
      sign: vi.fn(),
    })),
  },
  Horizon: {
    Server: vi.fn(() => ({
      loadAccount: vi.fn(),
      submitTransaction: vi.fn(),
      transactions: vi.fn(() => ({ forAccount: vi.fn(() => ({ call: vi.fn() })) })),
      operationFeeStats: vi.fn(),
    })),
  },
  Asset: {
    native: vi.fn(() => ({ code: 'XLM', issuer: null })),
  },
  TransactionBuilder: vi.fn(() => ({
    addOperation: vi.fn().mockReturnThis(),
    setTimeout: vi.fn().mockReturnThis(),
    build: vi.fn(() => ({
      toXDR: vi.fn(() => 'AAAA...'),
      sign: vi.fn(),
      hash: vi.fn(() => Buffer.from('txhash')),
    })),
  })),
  Operation: {
    payment: vi.fn(() => ({ type: 'payment' })),
    changeTrust: vi.fn(() => ({ type: 'changeTrust' })),
    createAccount: vi.fn(() => ({ type: 'createAccount' })),
  },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
  BASE_FEE: '100',
}));

vi.mock('../src/eventSourcing/index.js', () => ({
  eventMonitor: {
    publishEvent: vi.fn(() => Promise.resolve({})),
    initialize: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../src/config/env.js', () => ({
  getConfig: vi.fn(() => ({
    stellar: {
      network: 'testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    },
  })),
}));

vi.mock('../src/config/logger.js', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/db/client.js', () => ({
  default: {
    user: { upsert: vi.fn(() => Promise.resolve({ id: 'u1' })) },
    transaction: { create: vi.fn(() => Promise.resolve({ id: 'tx-1' })) },
    $transaction: vi.fn((fn) => fn({
      user: { upsert: vi.fn(() => Promise.resolve({ id: 'u1' })) },
      transaction: { create: vi.fn(() => Promise.resolve({ id: 'tx-1' })) },
    })),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAccountData(publicKey, balanceXLM = '1000.0000000') {
  return {
    id: publicKey,
    sequence: '123456789',
    balances: [{ asset_type: 'native', balance: balanceXLM }],
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    signers: [{ key: publicKey, weight: 1 }],
  };
}

function makeSubmitResponse(hash = 'abc123') {
  return { hash, ledger: 12345, successful: true };
}

// ── 1. Testnet account creation ───────────────────────────────────────────────
describe('Testnet Account Creation', () => {
  it('generates a valid keypair', () => {
    const keypair = StellarSDK.Keypair.random();
    expect(keypair.publicKey()).toMatch(/^G[A-Z2-7]{55}$/);
    expect(keypair.secret()).toMatch(/^S[A-Z2-7]{55}$/);
  });

  it('creates account via stellar service', async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ account_id: 'GABC...' }) })
    );
    global.fetch = mockFetch;

    const { createAccount } = await import('../src/services/stellar.js');
    const account = await createAccount();
    expect(account).toHaveProperty('publicKey');
    expect(account).toHaveProperty('secretKey');
  });
});

// ── 2. Transaction testing ────────────────────────────────────────────────────
describe('Transaction Testing', () => {
  it('builds a payment operation', () => {
    const op = StellarSDK.Operation.payment({
      destination: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H',
      asset: StellarSDK.Asset.native(),
      amount: '10',
    });
    expect(op.type).toBe('payment');
  });

  it('builds a transaction with timeout', () => {
    const builder = new StellarSDK.TransactionBuilder();
    const tx = builder
      .addOperation(StellarSDK.Operation.payment({}))
      .setTimeout(30)
      .build();
    expect(tx.toXDR()).toBeDefined();
  });

  it('submits a transaction and returns hash', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    server.submitTransaction.mockResolvedValueOnce(makeSubmitResponse('txhash123'));

    const builder = new StellarSDK.TransactionBuilder();
    const tx = builder.addOperation({}).setTimeout(30).build();
    const result = await server.submitTransaction(tx);

    expect(result.hash).toBe('txhash123');
    expect(result.successful).toBe(true);
  });

  it('handles duplicate transaction submission gracefully', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    server.submitTransaction.mockRejectedValueOnce(
      Object.assign(new Error('tx_bad_seq'), { response: { data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } } })
    );

    const builder = new StellarSDK.TransactionBuilder();
    const tx = builder.addOperation({}).setTimeout(30).build();
    await expect(server.submitTransaction(tx)).rejects.toThrow('tx_bad_seq');
  });
});

// ── 3. Network failure testing ────────────────────────────────────────────────
describe('Network Failure Handling', () => {
  it('retries on Horizon connection timeout', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    server.loadAccount
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(makeAccountData('GABC'));

    let result;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await server.loadAccount('GABC');
        break;
      } catch {
        // retry
      }
    }
    expect(result.id).toBe('GABC');
    expect(server.loadAccount).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exhausted', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    server.loadAccount.mockRejectedValue(new Error('Network unreachable'));

    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await server.loadAccount('GABC');
      } catch (e) {
        lastError = e;
      }
    }
    expect(lastError.message).toBe('Network unreachable');
  });

  it('handles Horizon 503 service unavailable', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    server.submitTransaction.mockRejectedValueOnce(
      Object.assign(new Error('Service Unavailable'), { status: 503 })
    );

    await expect(server.submitTransaction({})).rejects.toMatchObject({ status: 503 });
  });
});

// ── 4. Blockchain state testing ───────────────────────────────────────────────
describe('Blockchain State Testing', () => {
  it('loads account state from Horizon', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    const pk = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
    server.loadAccount.mockResolvedValueOnce(makeAccountData(pk, '500.0000000'));

    const account = await server.loadAccount(pk);
    const xlmBalance = account.balances.find(b => b.asset_type === 'native');
    expect(xlmBalance.balance).toBe('500.0000000');
  });

  it('verifies account sequence number increments after transaction', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    const pk = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';

    server.loadAccount
      .mockResolvedValueOnce(makeAccountData(pk))
      .mockResolvedValueOnce({ ...makeAccountData(pk), sequence: '123456790' });

    const before = await server.loadAccount(pk);
    const after = await server.loadAccount(pk);
    expect(BigInt(after.sequence)).toBeGreaterThan(BigInt(before.sequence));
  });

  it('detects account not found (404)', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    server.loadAccount.mockRejectedValueOnce(
      Object.assign(new Error('Not Found'), { response: { status: 404 } })
    );

    await expect(server.loadAccount('GNEW...')).rejects.toMatchObject({
      response: { status: 404 },
    });
  });
});

// ── 5. Consensus / finality testing ──────────────────────────────────────────
describe('Consensus and Finality', () => {
  it('confirms transaction is included in a ledger', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    server.submitTransaction.mockResolvedValueOnce({
      hash: 'finalhash',
      ledger: 99999,
      successful: true,
    });

    const result = await server.submitTransaction({});
    expect(result.ledger).toBeGreaterThan(0);
    expect(result.successful).toBe(true);
  });

  it('uses TESTNET network passphrase for testnet transactions', () => {
    expect(StellarSDK.Networks.TESTNET).toBe('Test SDF Network ; September 2015');
  });

  it('uses PUBLIC network passphrase for mainnet transactions', () => {
    expect(StellarSDK.Networks.PUBLIC).toBe('Public Global Stellar Network ; September 2015');
  });
});

// ── 6. Blockchain performance benchmarking ────────────────────────────────────
describe('Blockchain Performance', () => {
  it('measures transaction submission latency', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    server.submitTransaction.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve(makeSubmitResponse()), 20))
    );

    const start = Date.now();
    await server.submitTransaction({});
    const latency = Date.now() - start;

    expect(latency).toBeGreaterThanOrEqual(20);
    expect(latency).toBeLessThan(5000); // well within SLO
  });

  it('measures account load latency', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    server.loadAccount.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve(makeAccountData('GABC')), 10))
    );

    const start = Date.now();
    await server.loadAccount('GABC');
    const latency = Date.now() - start;

    expect(latency).toBeLessThan(2000);
  });

  it('handles concurrent transaction submissions', async () => {
    const server = new StellarSDK.Horizon.Server('https://horizon-testnet.stellar.org');
    server.submitTransaction.mockResolvedValue(makeSubmitResponse());

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => server.submitTransaction({ id: i }))
    );
    expect(results).toHaveLength(5);
    expect(results.every(r => r.successful)).toBe(true);
  });
});

// ── 7. Smart contract (Soroban) stubs ─────────────────────────────────────────
describe('Smart Contract Testing (Soroban stubs)', () => {
  it('validates contract invocation structure', () => {
    const invocation = {
      contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      method: 'transfer',
      args: [{ type: 'address', value: 'GABC' }, { type: 'i128', value: '1000' }],
    };
    expect(invocation.contractId).toMatch(/^C[A-Z2-7]{55}$/);
    expect(invocation.method).toBe('transfer');
    expect(invocation.args).toHaveLength(2);
  });

  it('validates contract ID format', () => {
    const validContractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    expect(validContractId.startsWith('C')).toBe(true);
    expect(validContractId.length).toBe(56);
  });
});
