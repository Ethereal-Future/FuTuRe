/**
 * Stellar API Integration Tests — Real Testnet
 *
 * These tests hit the actual Stellar testnet via Horizon and Friendbot.
 * They are intentionally slower than unit tests; run them with:
 *   vitest run tests/stellar.integration.test.js
 *
 * Required env (defaults to testnet if not set):
 *   STELLAR_NETWORK=testnet
 *   HORIZON_URL=https://horizon-testnet.stellar.org
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createFundedTestAccount, getXLMBalance, waitForAccount } from '../../testing/testnetAccount.js';

// ── Mock event sourcing so the service doesn't need a running store ──────────
vi.mock('../src/eventSourcing/index.js', () => ({
  eventMonitor: {
    publishEvent: vi.fn(() => Promise.resolve({})),
    initialize: vi.fn(() => Promise.resolve()),
  },
}));

// ── Import app AFTER mocks are in place ──────────────────────────────────────
const { default: app } = await import('./helpers/app.js');

// ── Shared test state ─────────────────────────────────────────────────────────
let sourceAccount; // funded account used as payment sender
let destAccount;   // funded account used as payment recipient

const VALID_PUBLIC_KEY = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H';
const INVALID_PUBLIC_KEY = 'not-a-valid-key';
const INVALID_SECRET_KEY = 'not-a-valid-secret';

// ── Setup / Teardown ──────────────────────────────────────────────────────────
beforeAll(async () => {
  // Create and fund two testnet accounts in parallel
  [sourceAccount, destAccount] = await Promise.all([
    createFundedTestAccount(),
    createFundedTestAccount(),
  ]);

  // Wait for both to be indexed on Horizon
  await Promise.all([
    waitForAccount(sourceAccount.publicKey),
    waitForAccount(destAccount.publicKey),
  ]);
}, 60_000);

afterAll(() => {
  // Testnet accounts are ephemeral — nothing to clean up
});

// ── Test Suites ───────────────────────────────────────────────────────────────

describe('POST /api/stellar/account/create', () => {
  it('returns a new keypair with publicKey and secretKey', async () => {
    const res = await request(app).post('/api/stellar/account/create');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('publicKey');
    expect(res.body).toHaveProperty('secretKey');
    expect(res.body.publicKey).toMatch(/^G[A-Z2-7]{55}$/);
    expect(res.body.secretKey).toMatch(/^S[A-Z2-7]{55}$/);
  });

  it('returns a unique keypair on each call', async () => {
    const [a, b] = await Promise.all([
      request(app).post('/api/stellar/account/create'),
      request(app).post('/api/stellar/account/create'),
    ]);

    expect(a.body.publicKey).not.toBe(b.body.publicKey);
    expect(a.body.secretKey).not.toBe(b.body.secretKey);
  });
});

describe('GET /api/stellar/account/:publicKey', () => {
  it('returns balances for a funded testnet account', async () => {
    const res = await request(app).get(`/api/stellar/account/${sourceAccount.publicKey}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('publicKey', sourceAccount.publicKey);
    expect(res.body).toHaveProperty('balances');
    expect(Array.isArray(res.body.balances)).toBe(true);

    const xlm = res.body.balances.find((b) => b.asset === 'XLM');
    expect(xlm).toBeDefined();
    expect(parseFloat(xlm.balance)).toBeGreaterThan(0);
  });

  it('returns balance shape with asset and balance fields', async () => {
    const res = await request(app).get(`/api/stellar/account/${sourceAccount.publicKey}`);

    res.body.balances.forEach((b) => {
      expect(b).toHaveProperty('asset');
      expect(b).toHaveProperty('balance');
      expect(typeof b.balance).toBe('string');
    });
  });

  it('returns 422 for an invalid public key', async () => {
    const res = await request(app).get(`/api/stellar/account/${INVALID_PUBLIC_KEY}`);

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('errors');
    expect(res.body.errors[0]).toHaveProperty('field', 'publicKey');
  });

  it('returns 500 for a valid-format but non-existent account', async () => {
    const res = await request(app).get(`/api/stellar/account/${VALID_PUBLIC_KEY}`);

    // Horizon returns 404 which the service surfaces as a 500
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /api/stellar/payment/send', () => {
  it('sends XLM between two funded testnet accounts', async () => {
    const balanceBefore = parseFloat(await getXLMBalance(destAccount.publicKey));

    const res = await request(app)
      .post('/api/stellar/payment/send')
      .send({
        sourceSecret: sourceAccount.secretKey,
        destination: destAccount.publicKey,
        amount: '1',
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hash');
    expect(res.body).toHaveProperty('ledger');
    expect(res.body.success).toBe(true);
    expect(typeof res.body.hash).toBe('string');
    expect(res.body.hash).toHaveLength(64);

    // Verify recipient balance increased
    const balanceAfter = parseFloat(await getXLMBalance(destAccount.publicKey));
    expect(balanceAfter).toBeGreaterThan(balanceBefore);
  }, 30_000);

  it('returns 422 for missing required fields', async () => {
    const res = await request(app)
      .post('/api/stellar/payment/send')
      .send({ destination: destAccount.publicKey, amount: '1' }); // missing sourceSecret

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('errors');
  });

  it('returns 422 for an invalid secret key', async () => {
    const res = await request(app)
      .post('/api/stellar/payment/send')
      .send({
        sourceSecret: INVALID_SECRET_KEY,
        destination: destAccount.publicKey,
        amount: '1',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toHaveProperty('field', 'sourceSecret');
  });

  it('returns 422 for an invalid destination key', async () => {
    const res = await request(app)
      .post('/api/stellar/payment/send')
      .send({
        sourceSecret: sourceAccount.secretKey,
        destination: INVALID_PUBLIC_KEY,
        amount: '1',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toHaveProperty('field', 'destination');
  });

  it('returns 422 for a zero or negative amount', async () => {
    const res = await request(app)
      .post('/api/stellar/payment/send')
      .send({
        sourceSecret: sourceAccount.secretKey,
        destination: destAccount.publicKey,
        amount: '-5',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toHaveProperty('field', 'amount');
  });

  it('returns 422 for an invalid asset code', async () => {
    const res = await request(app)
      .post('/api/stellar/payment/send')
      .send({
        sourceSecret: sourceAccount.secretKey,
        destination: destAccount.publicKey,
        amount: '1',
        assetCode: 'TOOLONGASSETCODE',
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toHaveProperty('field', 'assetCode');
  });

  it('returns 500 when sending more XLM than available balance', async () => {
    const res = await request(app)
      .post('/api/stellar/payment/send')
      .send({
        sourceSecret: sourceAccount.secretKey,
        destination: destAccount.publicKey,
        amount: '999999999',
      });

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  }, 30_000);
});

describe('GET /api/stellar/exchange-rate/:from/:to', () => {
  it('returns a rate for XLM/USD', async () => {
    const res = await request(app).get('/api/stellar/exchange-rate/XLM/USD');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('rate');
    expect(typeof res.body.rate).toBe('number');
  });

  it('returns 422 for invalid asset codes', async () => {
    const res = await request(app).get('/api/stellar/exchange-rate/!!!!/USD');

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('errors');
  });
});

describe('GET /api/stellar/network/status', () => {
  it('returns network status with expected fields', async () => {
    const res = await request(app).get('/api/stellar/network/status');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('network', 'testnet');
    expect(res.body).toHaveProperty('online');
    expect(res.body).toHaveProperty('horizonUrl');
  });

  it('reports online: true when testnet is reachable', async () => {
    const res = await request(app).get('/api/stellar/network/status');

    expect(res.body.online).toBe(true);
  });
});

describe('API response validation — shape contracts', () => {
  it('account/create response matches schema', async () => {
    const res = await request(app).post('/api/stellar/account/create');

    expect(Object.keys(res.body)).toEqual(expect.arrayContaining(['publicKey', 'secretKey']));
  });

  it('account balance response matches schema', async () => {
    const res = await request(app).get(`/api/stellar/account/${sourceAccount.publicKey}`);

    expect(res.body).toMatchObject({
      publicKey: expect.stringMatching(/^G[A-Z2-7]{55}$/),
      balances: expect.arrayContaining([
        expect.objectContaining({ asset: expect.any(String), balance: expect.any(String) }),
      ]),
    });
  });

  it('payment response matches schema', async () => {
    const res = await request(app)
      .post('/api/stellar/payment/send')
      .send({
        sourceSecret: sourceAccount.secretKey,
        destination: destAccount.publicKey,
        amount: '0.5',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      hash: expect.any(String),
      ledger: expect.any(Number),
      success: true,
    });
  }, 30_000);

  it('error responses always include an error field', async () => {
    const res = await request(app).get(`/api/stellar/account/${VALID_PUBLIC_KEY}`);

    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
  });

  it('validation error responses include errors array with field and message', async () => {
    const res = await request(app).get(`/api/stellar/account/${INVALID_PUBLIC_KEY}`);

    expect(res.body.errors).toBeInstanceOf(Array);
    res.body.errors.forEach((e) => {
      expect(e).toHaveProperty('field');
      expect(e).toHaveProperty('message');
    });
  });
});

describe('GET /api/stellar/account/:publicKey/transactions', () => {
  it('returns paginated transactions for a funded account', async () => {
    const res = await request(app).get(`/api/stellar/account/${sourceAccount.publicKey}/transactions`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('records');
    expect(Array.isArray(res.body.records)).toBe(true);
  });
});

describe('GET /api/stellar/fee-stats', () => {
  it('returns current network fee statistics', async () => {
    const res = await request(app).get('/api/stellar/fee-stats');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('feeStroops');
    expect(res.body).toHaveProperty('feeXLM');
    expect(typeof res.body.feeXLM).toBe('string');
  });
});

describe('GET /api/stellar/assets', () => {
  it('returns a list of supported assets and their issuers', async () => {
    const res = await request(app).get('/api/stellar/assets');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('assets');
    expect(Array.isArray(res.body.assets)).toBe(true);
    expect(res.body.assets.some(a => a.code === 'XLM')).toBe(true);
  });
});

describe('POST /api/stellar/trustline', () => {
  it('creates a trustline for a supported non-native asset', async () => {
    // Note: This requires the source account to have enough XLM for the reserve
    const res = await request(app)
      .post('/api/stellar/trustline')
      .send({
        sourceSecret: sourceAccount.secretKey,
        assetCode: 'USDC'
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hash');
    expect(res.body.assetCode).toBe('USDC');
  }, 45_000);

  it('returns 422 for creating a trustline with XLM', async () => {
    const res = await request(app)
      .post('/api/stellar/trustline')
      .send({
        sourceSecret: sourceAccount.secretKey,
        assetCode: 'XLM'
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toHaveProperty('field', 'assetCode');
  });
});
