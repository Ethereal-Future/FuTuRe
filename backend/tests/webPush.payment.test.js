/**
 * End-to-end test for #534 — payment-received push notification.
 *
 * Verifies that sendWebPush is called with the correct payload (sender address,
 * amount, asset code, and deep-link URL) when a payment is processed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../src/notifications/webPush.js', () => ({
  getSubscriptionByPublicKey: vi.fn(),
  sendWebPush: vi.fn(() => Promise.resolve({ sent: true })),
  saveSubscription: vi.fn(),
  getSubscription: vi.fn(),
}));

vi.mock('../src/services/stellar.js', () => ({
  sendPayment: vi.fn(),
  getBalance: vi.fn(() => Promise.resolve({ balances: [] })),
  isTestnet: vi.fn(() => true),
}));

vi.mock('../src/services/websocket.js', () => ({
  broadcastToAccount: vi.fn(),
}));

vi.mock('../src/webhooks/dispatcher.js', () => ({
  dispatchEvent: vi.fn(),
}));

vi.mock('../src/middleware/validate.js', () => ({
  validate: (_req, _res, next) => next(),
  rules: {
    sendPayment: [],
    publicKeyBody: [],
    publicKeyParam: [],
    importAccount: [],
    assetCodeParams: [],
    createTrustline: [],
    removeTrustline: [],
    mergeAccount: [],
  },
}));

vi.mock('../src/middleware/rateLimiter.js', () => ({
  createRateLimiter: () => (_req, _res, next) => next(),
}));

vi.mock('../src/middleware/idempotency.js', () => ({
  idempotencyMiddleware: (_req, _res, next) => next(),
}));

vi.mock('../src/middleware/kyc.js', () => ({
  requireKYC: (_req, _res, next) => next(),
}));

vi.mock('../src/middleware/mfa.js', () => ({
  optionalMFA: (_req, _res, next) => next(),
}));

vi.mock('../src/compliance/sanctionsChecker.js', () => ({
  default: { check: vi.fn(() => Promise.resolve({ hit: false })) },
}));

vi.mock('../src/compliance/amlMonitor.js', () => ({
  default: { screenTransaction: vi.fn(() => Promise.resolve()) },
}));

vi.mock('../src/cache/appCache.js', () => ({
  keys: {
    balance: vi.fn(() => 'bal-key'),
    feeStats: vi.fn(() => 'fee-key'),
    rate: vi.fn(() => 'rate-key'),
  },
  TTL: { BALANCE: 30, FEE_STATS: 120, RATE: 60 },
  invalidateBalance: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/middleware/cache.js', () => ({
  cacheMiddleware: () => (_req, _res, next) => next(),
}));

vi.mock('../src/config/assets.js', () => ({
  SUPPORTED_ASSETS: ['XLM', 'USDC'],
  getIssuer: vi.fn(() => 'GA5Z'),
}));

vi.mock('../src/db/client.js', () => ({
  default: {
    kYCRecord: { findFirst: vi.fn(() => Promise.resolve(null)) },
    transaction: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    user: {
      findUnique: vi.fn(() => Promise.resolve(null)),
      upsert: vi.fn(() => Promise.resolve({ id: 1 })),
    },
    setting: { upsert: vi.fn(() => Promise.resolve({})) },
  },
}));

vi.mock('../src/config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromSecret: vi.fn(() => ({
      publicKey: () => 'GSENDER1234567890123456789012345678901234567890123456',
    })),
  },
}));

vi.mock('../src/services/amm.js', () => ({
  getAllPools: vi.fn(() => []),
  registerPool: vi.fn(),
  getPoolState: vi.fn(),
  executeSwap: vi.fn(),
  detectArbitrageOpportunities: vi.fn(() => []),
  runAutomatedStrategy: vi.fn(),
  automateLiquidityProvision: vi.fn(),
  estimateYieldFarming: vi.fn(),
  getAMMAnalytics: vi.fn(() => ({})),
  runRiskChecks: vi.fn(() => ({})),
  optimizeAMMPerformance: vi.fn(() => ({})),
}));

vi.mock('../src/services/exchangeRate.js', () => ({
  getRate: vi.fn(),
  getAllRates: vi.fn(() => Promise.resolve({})),
  convert: vi.fn(),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

import * as webPush from '../src/notifications/webPush.js';
import * as StellarService from '../src/services/stellar.js';

const DEST_KEY = 'GDEST1234567890123456789012345678901234567890123456789';
const TX_HASH = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';

describe('Payment received — push notification payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    StellarService.sendPayment.mockResolvedValue({ hash: TX_HASH, successful: true, ledger: 1 });
    webPush.getSubscriptionByPublicKey.mockReturnValue({
      endpoint: 'https://push.example.com/sub1',
    });
  });

  it('calls sendWebPush when a push subscription exists for the recipient', async () => {
    const { default: router } = await import('../src/routes/stellar.js');
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const bodyParser = (await import('body-parser')).default;

    const app = express();
    app.use(bodyParser.json());
    app.use('/api/stellar', router);

    await request(app).post('/api/stellar/payment/send').send({
      sourceSecret: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
      destination: DEST_KEY,
      amount: '50',
      assetCode: 'XLM',
    });

    expect(webPush.sendWebPush).toHaveBeenCalled();
  });

  it('includes sender address (truncated), amount, and assetCode in notification', async () => {
    const { default: router } = await import('../src/routes/stellar.js');
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const bodyParser = (await import('body-parser')).default;

    const app = express();
    app.use(bodyParser.json());
    app.use('/api/stellar', router);

    await request(app).post('/api/stellar/payment/send').send({
      sourceSecret: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
      destination: DEST_KEY,
      amount: '50',
      assetCode: 'XLM',
    });

    const [, payload] = webPush.sendWebPush.mock.calls[0];
    expect(payload).toMatchObject({
      title: 'Payment received',
      data: expect.objectContaining({
        amount: '50',
        assetCode: 'XLM',
      }),
    });
    expect(payload.body).toMatch(/50 XLM/);
    expect(payload.body).toMatch(/GSEN.*3456/);
  });

  it('includes a deep-link URL pointing to the transaction', async () => {
    const { default: router } = await import('../src/routes/stellar.js');
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const bodyParser = (await import('body-parser')).default;

    const app = express();
    app.use(bodyParser.json());
    app.use('/api/stellar', router);

    await request(app).post('/api/stellar/payment/send').send({
      sourceSecret: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
      destination: DEST_KEY,
      amount: '50',
      assetCode: 'XLM',
    });

    const [, payload] = webPush.sendWebPush.mock.calls[0];
    expect(payload.data.url).toContain(`#tx=${TX_HASH}`);
  });

  it('does NOT call sendWebPush when no subscription is registered', async () => {
    webPush.getSubscriptionByPublicKey.mockReturnValue(null);

    const { default: router } = await import('../src/routes/stellar.js');
    const express = (await import('express')).default;
    const request = (await import('supertest')).default;
    const bodyParser = (await import('body-parser')).default;

    const app = express();
    app.use(bodyParser.json());
    app.use('/api/stellar', router);

    await request(app).post('/api/stellar/payment/send').send({
      sourceSecret: 'SCZANGBA5RLKJNMDBJKTA7LCMNSZXJVLCMSBXOLQXGAEOP7SKNU4PX2',
      destination: DEST_KEY,
      amount: '50',
      assetCode: 'XLM',
    });

    expect(webPush.sendWebPush).not.toHaveBeenCalled();
  });
});
