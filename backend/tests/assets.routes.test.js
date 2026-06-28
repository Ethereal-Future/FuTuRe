/**
 * Integration tests for /assets routes
 * Covers asset listing, trustline operations, and portfolio/balance endpoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRegistry = vi.hoisted(() => ({
  getAllAssets: vi.fn(),
  registerAsset: vi.fn(),
  getAsset: vi.fn(),
  discoverAssets: vi.fn(),
  trackAssetPrice: vi.fn(),
}));

const mockTrustline = vi.hoisted(() => ({
  createTrustline: vi.fn(),
  getTrustlines: vi.fn(),
}));

const mockPortfolio = vi.hoisted(() => ({
  getPortfolio: vi.fn(),
  getPortfolioSummary: vi.fn(),
}));

const mockConverter = vi.hoisted(() => ({
  convertAsset: vi.fn(),
}));

vi.mock('../src/services/assetRegistry.js', () => ({
  default: vi.fn(function () { return mockRegistry; }),
}));

vi.mock('../src/services/trustlineManager.js', () => ({
  default: vi.fn(function () { return mockTrustline; }),
}));

vi.mock('../src/services/assetPortfolio.js', () => ({
  default: vi.fn(function () { return mockPortfolio; }),
}));

vi.mock('../src/services/assetConverter.js', () => ({
  default: vi.fn(function () { return mockConverter; }),
}));

import assetsRoutes from '../src/routes/assets.js';

const VALID_PUBLIC_KEY = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
// S + 55 uppercase letters = 56-char valid strkey secret (matches regex, not a real key)
const VALID_SECRET_KEY = 'SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const VALID_ASSET_CODE = 'USDC';

process.env.STELLAR_NETWORK = 'testnet';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/assets', assetsRoutes);
  return app;
}

describe('GET /api/assets', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns the list of registered assets with correct shape', async () => {
    const assets = [
      { code: 'USDC', issuer: VALID_PUBLIC_KEY, name: 'USD Coin', verified: true },
      { code: 'BTC', issuer: VALID_PUBLIC_KEY, name: 'Bitcoin', verified: false },
    ];
    mockRegistry.getAllAssets.mockReturnValue(assets);

    const res = await request(app).get('/api/assets');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].code).toBe('USDC');
    expect(res.body[0].issuer).toBeDefined();
  });

  it('returns 200 with an empty array when no assets are configured', async () => {
    mockRegistry.getAllAssets.mockReturnValue([]);

    const res = await request(app).get('/api/assets');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 500 when the registry throws', async () => {
    mockRegistry.getAllAssets.mockImplementation(() => {
      throw new Error('Registry unavailable');
    });

    const res = await request(app).get('/api/assets');

    expect(res.status).toBe(500);
  });
});

describe('GET /api/assets/:code/:issuer', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns the asset when found', async () => {
    const asset = { code: VALID_ASSET_CODE, issuer: VALID_PUBLIC_KEY, name: 'USD Coin' };
    mockRegistry.getAsset.mockReturnValue(asset);

    const res = await request(app).get(`/api/assets/${VALID_ASSET_CODE}/${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(VALID_ASSET_CODE);
  });

  it('returns 404 when the asset is not found', async () => {
    mockRegistry.getAsset.mockReturnValue(null);

    const res = await request(app).get(`/api/assets/UNKNOWN/${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });

  it('returns 422 when the asset code is invalid', async () => {
    const res = await request(app).get(`/api/assets/invalid-code!/${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(422);
  });

  it('returns 422 when the issuer key is invalid', async () => {
    const res = await request(app).get(`/api/assets/${VALID_ASSET_CODE}/notavalidkey`);

    expect(res.status).toBe(422);
  });
});

describe('POST /api/assets/trustline', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('creates a trustline and returns the transaction result', async () => {
    mockTrustline.createTrustline.mockResolvedValue({
      success: true,
      hash: 'abc123def456',
    });

    const res = await request(app)
      .post('/api/assets/trustline')
      .send({
        sourceSecret: VALID_SECRET_KEY,
        assetCode: VALID_ASSET_CODE,
        assetIssuer: VALID_PUBLIC_KEY,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hash).toBeDefined();
  });

  it('returns 422 when the secret key is invalid', async () => {
    const res = await request(app)
      .post('/api/assets/trustline')
      .send({
        sourceSecret: 'not-a-secret-key',
        assetCode: VALID_ASSET_CODE,
        assetIssuer: VALID_PUBLIC_KEY,
      });

    expect(res.status).toBe(422);
  });

  it('returns 422 when the asset code is not supported', async () => {
    const res = await request(app)
      .post('/api/assets/trustline')
      .send({
        sourceSecret: VALID_SECRET_KEY,
        assetCode: 'NOTREAL',
        assetIssuer: VALID_PUBLIC_KEY,
      });

    expect(res.status).toBe(422);
  });

  it('returns 422 when the asset issuer is invalid', async () => {
    const res = await request(app)
      .post('/api/assets/trustline')
      .send({
        sourceSecret: VALID_SECRET_KEY,
        assetCode: VALID_ASSET_CODE,
        assetIssuer: 'badissuer',
      });

    expect(res.status).toBe(422);
  });

  it('returns 400 when the Horizon call fails', async () => {
    mockTrustline.createTrustline.mockRejectedValue(new Error('Horizon error'));

    const res = await request(app)
      .post('/api/assets/trustline')
      .send({
        sourceSecret: VALID_SECRET_KEY,
        assetCode: VALID_ASSET_CODE,
        assetIssuer: VALID_PUBLIC_KEY,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

describe('GET /api/assets/trustlines/:publicKey', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns trustlines for a valid public key', async () => {
    const trustlines = [
      { asset_code: 'USDC', asset_issuer: VALID_PUBLIC_KEY, balance: '100.0000000' },
    ];
    mockTrustline.getTrustlines.mockResolvedValue(trustlines);

    const res = await request(app).get(`/api/assets/trustlines/${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].asset_code).toBe('USDC');
  });

  it('returns 422 when the public key format is invalid', async () => {
    const res = await request(app).get('/api/assets/trustlines/notakey');

    expect(res.status).toBe(422);
  });

  it('returns 500 when Horizon is unreachable', async () => {
    mockTrustline.getTrustlines.mockRejectedValue(new Error('Network error'));

    const res = await request(app).get(`/api/assets/trustlines/${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(500);
  });
});

describe('GET /api/assets/portfolio/:publicKey', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns portfolio data for the account', async () => {
    const portfolio = {
      publicKey: VALID_PUBLIC_KEY,
      balances: [{ asset_code: 'USDC', balance: '50.0000000' }],
      totalValueXLM: '500',
    };
    mockPortfolio.getPortfolio.mockResolvedValue(portfolio);

    const res = await request(app).get(`/api/assets/portfolio/${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.publicKey).toBe(VALID_PUBLIC_KEY);
    expect(res.body.balances).toBeDefined();
  });

  it('handles accounts with zero balances without errors', async () => {
    mockPortfolio.getPortfolio.mockResolvedValue({
      publicKey: VALID_PUBLIC_KEY,
      balances: [],
      totalValueXLM: '0',
    });

    const res = await request(app).get(`/api/assets/portfolio/${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.balances).toEqual([]);
  });

  it('returns 422 when the public key is invalid', async () => {
    const res = await request(app).get('/api/assets/portfolio/badkey');

    expect(res.status).toBe(422);
  });

  it('returns 500 when Horizon is unreachable', async () => {
    mockPortfolio.getPortfolio.mockRejectedValue(new Error('Service unavailable'));

    const res = await request(app).get(`/api/assets/portfolio/${VALID_PUBLIC_KEY}`);

    expect(res.status).toBe(500);
  });
});
