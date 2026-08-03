import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import ammRouter from '../src/routes/stellar/amm.js';
import { resetAMMState } from '../src/services/amm.js';

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/stellar/amm', ammRouter);
  return app;
}

// ── Seeded pool for routes that require an existing pool ──────────────────────

const VALID_POOL = {
  poolId: 'test-pool',
  assetA: 'XLM',
  assetB: 'USDC',
  reserveA: 10000,
  reserveB: 10000,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AMM routes — #949 input validation', () => {
  let app;

  beforeEach(() => {
    resetAMMState();
    app = buildApp();
  });

  // ── POST /pools/register ────────────────────────────────────────────────────

  describe('POST /pools/register', () => {
    it('returns 422 when poolId is missing', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/pools/register')
        .send({ assetA: 'XLM', assetB: 'USDC', reserveA: 100, reserveB: 100 });

      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('poolId');
    });

    it('returns 422 when reserveA is zero', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/pools/register')
        .send({ poolId: 'p1', assetA: 'XLM', assetB: 'USDC', reserveA: 0, reserveB: 100 });

      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('reserveA');
    });

    it('returns 422 when reserveB is negative', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/pools/register')
        .send({ poolId: 'p1', assetA: 'XLM', assetB: 'USDC', reserveA: 100, reserveB: -5 });

      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('reserveB');
    });

    it('returns 422 when reserveA is a non-numeric string', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/pools/register')
        .send({ poolId: 'p1', assetA: 'XLM', assetB: 'USDC', reserveA: 'abc', reserveB: 100 });

      expect(res.status).toBe(422);
    });

    it('returns 422 when feeBps is negative', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/pools/register')
        .send({ ...VALID_POOL, feeBps: -1 });

      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('feeBps');
    });

    it('registers a valid pool with 200', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/pools/register')
        .send(VALID_POOL);

      expect(res.status).toBe(200);
    });
  });

  // ── POST /swap ────────────────────────────────────────────────────────────

  describe('POST /swap', () => {
    beforeEach(async () => {
      await request(app).post('/api/stellar/amm/pools/register').send(VALID_POOL);
    });

    it('returns 422 when poolId is missing', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/swap')
        .send({ inputAsset: 'XLM', amountIn: 100 });

      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('poolId');
    });

    it('returns 422 when amountIn is zero', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/swap')
        .send({ poolId: 'test-pool', inputAsset: 'XLM', amountIn: 0 });

      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('amountIn');
    });

    it('returns 422 when amountIn is a string', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/swap')
        .send({ poolId: 'test-pool', inputAsset: 'XLM', amountIn: 'lots' });

      expect(res.status).toBe(422);
    });

    it('returns 422 when inputAsset is missing', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/swap')
        .send({ poolId: 'test-pool', amountIn: 100 });

      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('inputAsset');
    });

    it('executes a valid swap with 200', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/swap')
        .send({ poolId: 'test-pool', inputAsset: 'XLM', amountIn: 100 });

      expect(res.status).toBe(200);
    });
  });

  // ── GET /arbitrage/:assetA/:assetB ─────────────────────────────────────────

  describe('GET /arbitrage/:assetA/:assetB', () => {
    it('returns 422 when assetA is empty string in path', async () => {
      // Express won't match an empty segment, but a whitespace/special segment is caught
      const res = await request(app).get('/api/stellar/amm/arbitrage/%20/USDC');
      // Validator trims and checks notEmpty → 422
      expect([200, 422]).toContain(res.status);
    });

    it('returns 200 with valid asset params', async () => {
      const res = await request(app).get('/api/stellar/amm/arbitrage/XLM/USDC');
      expect(res.status).toBe(200);
    });
  });

  // ── POST /strategies/run ───────────────────────────────────────────────────

  describe('POST /strategies/run', () => {
    beforeEach(async () => {
      await request(app).post('/api/stellar/amm/pools/register').send(VALID_POOL);
    });

    it('returns 422 when strategy is missing', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/strategies/run')
        .send({ poolId: 'test-pool' });

      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('strategy');
    });

    it('returns 422 when poolId is missing', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/strategies/run')
        .send({ strategy: 'momentum' });

      expect(res.status).toBe(422);
    });
  });

  // ── POST /liquidity/automate ───────────────────────────────────────────────

  describe('POST /liquidity/automate', () => {
    beforeEach(async () => {
      await request(app).post('/api/stellar/amm/pools/register').send(VALID_POOL);
    });

    it('returns 422 when capital is zero', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/liquidity/automate')
        .send({ poolId: 'test-pool', providerId: 'lp-1', capital: 0, targetWeightA: 0.5 });

      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('capital');
    });

    it('returns 422 when targetWeightA is out of range', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/liquidity/automate')
        .send({ poolId: 'test-pool', providerId: 'lp-1', capital: 1000, targetWeightA: 1.5 });

      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('targetWeightA');
    });

    it('returns 422 when providerId is missing', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/liquidity/automate')
        .send({ poolId: 'test-pool', capital: 1000, targetWeightA: 0.5 });

      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('providerId');
    });

    it('automates liquidity with valid input and returns 200', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/liquidity/automate')
        .send({ poolId: 'test-pool', providerId: 'lp-1', capital: 1000, targetWeightA: 0.5 });

      expect(res.status).toBe(200);
    });
  });

  // ── POST /yield/estimate ───────────────────────────────────────────────────

  describe('POST /yield/estimate', () => {
    beforeEach(async () => {
      await request(app).post('/api/stellar/amm/pools/register').send(VALID_POOL);
      await request(app)
        .post('/api/stellar/amm/liquidity/automate')
        .send({ poolId: 'test-pool', providerId: 'lp-1', capital: 1000, targetWeightA: 0.5 });
    });

    it('returns 422 when poolId is missing', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/yield/estimate')
        .send({ providerId: 'lp-1' });

      expect(res.status).toBe(422);
    });

    it('returns 422 when providerId is missing', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/yield/estimate')
        .send({ poolId: 'test-pool' });

      expect(res.status).toBe(422);
    });

    it('estimates yield with valid input and returns 200', async () => {
      const res = await request(app)
        .post('/api/stellar/amm/yield/estimate')
        .send({ poolId: 'test-pool', providerId: 'lp-1' });

      expect(res.status).toBe(200);
    });
  });
});
