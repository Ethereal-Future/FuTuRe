import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// ── Mock service layer so tests never hit Horizon ────────────────────────────

vi.mock('../src/services/offer.js', () => ({
  getAccountOffers: vi.fn().mockResolvedValue([]),
  createOffer: vi.fn().mockResolvedValue({ offerId: '1', hash: 'abc' }),
  modifyOffer: vi.fn().mockResolvedValue({ offerId: '1', hash: 'abc' }),
  cancelOffer: vi.fn().mockResolvedValue({ offerId: '1', hash: 'abc' }),
}));

vi.mock('../src/services/pool.js', () => ({
  estimateDepositFees: vi.fn().mockResolvedValue({ estimatedShares: '100', fee: '0.0001' }),
  estimateWithdrawFees: vi.fn().mockResolvedValue({ estimatedAmountA: '50', estimatedAmountB: '50', fee: '0.0001' }),
  executeDeposit: vi.fn().mockResolvedValue({ shares: '100', hash: 'abc' }),
  executeWithdraw: vi.fn().mockResolvedValue({ amountA: '50', amountB: '50', hash: 'abc' }),
}));

import offersRouter from '../src/routes/stellar/offers.js';
import poolOpsRouter from '../src/routes/stellar/pool-operations.js';

// ── App factories ─────────────────────────────────────────────────────────────

function buildOffersApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/stellar/offers', offersRouter);
  return app;
}

function buildPoolApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/stellar/pool', poolOpsRouter);
  return app;
}

// Valid test fixtures
const VALID_SECRET = 'SCZANGBA5AKIA7DEOLNQQ6TJWLMZ5QFCEMQZGRQASXN7TQLM4LOE5VF';
const VALID_ACCOUNT = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN';

// ── Offers.js validation tests ────────────────────────────────────────────────

describe('Offers routes — #950 input validation', () => {
  let app;

  beforeEach(() => {
    app = buildOffersApp();
    vi.clearAllMocks();
  });

  // ── GET /:accountId ──────────────────────────────────────────────────────

  describe('GET /:accountId', () => {
    it('returns 422 when accountId is not a valid public key', async () => {
      const res = await request(app).get('/api/stellar/offers/not-a-key');
      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('accountId');
    });

    it('returns 200 with a valid public key', async () => {
      const res = await request(app).get(`/api/stellar/offers/${VALID_ACCOUNT}`);
      expect(res.status).toBe(200);
    });
  });

  // ── POST /create ─────────────────────────────────────────────────────────

  describe('POST /create', () => {
    const validBody = {
      sourceSecret: VALID_SECRET,
      sellingAsset: 'XLM',
      buyingAsset: 'USDC',
      sellingAmount: '100',
      price: '1.5',
    };

    it('returns 422 when sourceSecret is missing', async () => {
      const { sourceSecret: _, ...body } = validBody;
      const res = await request(app).post('/api/stellar/offers/create').send(body);
      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('sourceSecret');
    });

    it('returns 422 when sourceSecret is a garbage string', async () => {
      const res = await request(app)
        .post('/api/stellar/offers/create')
        .send({ ...validBody, sourceSecret: 'not-a-secret' });
      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('sourceSecret');
    });

    it('returns 422 when sourceSecret looks like a public key (G…)', async () => {
      const res = await request(app)
        .post('/api/stellar/offers/create')
        .send({ ...validBody, sourceSecret: VALID_ACCOUNT });
      expect(res.status).toBe(422);
    });

    it('returns 422 when sellingAmount is zero', async () => {
      const res = await request(app)
        .post('/api/stellar/offers/create')
        .send({ ...validBody, sellingAmount: 0 });
      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('sellingAmount');
    });

    it('returns 422 when sellingAmount is negative', async () => {
      const res = await request(app)
        .post('/api/stellar/offers/create')
        .send({ ...validBody, sellingAmount: -10 });
      expect(res.status).toBe(422);
    });

    it('returns 422 when price is zero', async () => {
      const res = await request(app)
        .post('/api/stellar/offers/create')
        .send({ ...validBody, price: 0 });
      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('price');
    });

    it('returns 422 when sellingAsset is missing', async () => {
      const { sellingAsset: _, ...body } = validBody;
      const res = await request(app).post('/api/stellar/offers/create').send(body);
      expect(res.status).toBe(422);
    });

    it('calls service and returns 200 with valid body', async () => {
      const res = await request(app).post('/api/stellar/offers/create').send(validBody);
      expect(res.status).toBe(200);
    });

    it('does not reach the service when validation fails', async () => {
      const { OfferService } = await import('../src/services/offer.js');
      const createOffer = (await import('../src/services/offer.js')).createOffer;
      vi.clearAllMocks();
      await request(app)
        .post('/api/stellar/offers/create')
        .send({ ...validBody, sellingAmount: -1 });
      expect(createOffer).not.toHaveBeenCalled();
    });
  });

  // ── POST /modify ─────────────────────────────────────────────────────────

  describe('POST /modify', () => {
    const validBody = {
      sourceSecret: VALID_SECRET,
      offerId: '12345',
      sellingAsset: 'XLM',
      buyingAsset: 'USDC',
      sellingAmount: '100',
      price: '1.5',
    };

    it('returns 422 when sourceSecret is invalid', async () => {
      const res = await request(app)
        .post('/api/stellar/offers/modify')
        .send({ ...validBody, sourceSecret: 'bad' });
      expect(res.status).toBe(422);
    });

    it('returns 422 when offerId is missing', async () => {
      const { offerId: _, ...body } = validBody;
      const res = await request(app).post('/api/stellar/offers/modify').send(body);
      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('offerId');
    });

    it('returns 200 with valid body', async () => {
      const res = await request(app).post('/api/stellar/offers/modify').send(validBody);
      expect(res.status).toBe(200);
    });
  });

  // ── POST /cancel ─────────────────────────────────────────────────────────

  describe('POST /cancel', () => {
    it('returns 422 when sourceSecret is missing', async () => {
      const res = await request(app)
        .post('/api/stellar/offers/cancel')
        .send({ offerId: '123' });
      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('sourceSecret');
    });

    it('returns 422 when offerId is missing', async () => {
      const res = await request(app)
        .post('/api/stellar/offers/cancel')
        .send({ sourceSecret: VALID_SECRET });
      expect(res.status).toBe(422);
      const fields = res.body.errors.map((e) => e.field);
      expect(fields).toContain('offerId');
    });

    it('returns 200 with valid body', async () => {
      const res = await request(app)
        .post('/api/stellar/offers/cancel')
        .send({ sourceSecret: VALID_SECRET, offerId: '999' });
      expect(res.status).toBe(200);
    });
  });
});

// ── Pool-operations.js validation tests ──────────────────────────────────────

describe('Pool-operations routes — #950 input validation', () => {
  let app;

  beforeEach(() => {
    app = buildPoolApp();
    vi.clearAllMocks();
  });

  const validDepositEstimate = {
    poolId: 'pool-abc123',
    amountA: 100,
    amountB: 100,
    slippageTolerance: 0.01,
  };

  const validWithdrawEstimate = {
    poolId: 'pool-abc123',
    shares: 50,
    slippageTolerance: 0.01,
  };

  // ── POST /deposit/estimate ────────────────────────────────────────────────

  describe('POST /deposit/estimate', () => {
    it('returns 422 when poolId is missing', async () => {
      const { poolId: _, ...body } = validDepositEstimate;
      const res = await request(app).post('/api/stellar/pool/deposit/estimate').send(body);
      expect(res.status).toBe(422);
      expect(res.body.errors.map((e) => e.field)).toContain('poolId');
    });

    it('returns 422 when amountA is zero', async () => {
      const res = await request(app)
        .post('/api/stellar/pool/deposit/estimate')
        .send({ ...validDepositEstimate, amountA: 0 });
      expect(res.status).toBe(422);
      expect(res.body.errors.map((e) => e.field)).toContain('amountA');
    });

    it('returns 422 when slippageTolerance is negative', async () => {
      const res = await request(app)
        .post('/api/stellar/pool/deposit/estimate')
        .send({ ...validDepositEstimate, slippageTolerance: -0.1 });
      expect(res.status).toBe(422);
      expect(res.body.errors.map((e) => e.field)).toContain('slippageTolerance');
    });

    it('returns 422 when slippageTolerance exceeds 1', async () => {
      const res = await request(app)
        .post('/api/stellar/pool/deposit/estimate')
        .send({ ...validDepositEstimate, slippageTolerance: 1.5 });
      expect(res.status).toBe(422);
    });

    it('returns 200 with valid body', async () => {
      const res = await request(app)
        .post('/api/stellar/pool/deposit/estimate')
        .send(validDepositEstimate);
      expect(res.status).toBe(200);
    });
  });

  // ── POST /withdraw/estimate ───────────────────────────────────────────────

  describe('POST /withdraw/estimate', () => {
    it('returns 422 when shares is zero', async () => {
      const res = await request(app)
        .post('/api/stellar/pool/withdraw/estimate')
        .send({ ...validWithdrawEstimate, shares: 0 });
      expect(res.status).toBe(422);
      expect(res.body.errors.map((e) => e.field)).toContain('shares');
    });

    it('returns 422 when slippageTolerance is NaN', async () => {
      const res = await request(app)
        .post('/api/stellar/pool/withdraw/estimate')
        .send({ ...validWithdrawEstimate, slippageTolerance: 'oops' });
      expect(res.status).toBe(422);
    });

    it('returns 200 with valid body', async () => {
      const res = await request(app)
        .post('/api/stellar/pool/withdraw/estimate')
        .send(validWithdrawEstimate);
      expect(res.status).toBe(200);
    });
  });

  // ── POST /deposit ─────────────────────────────────────────────────────────

  describe('POST /deposit', () => {
    const validDeposit = {
      sourceSecret: VALID_SECRET,
      ...validDepositEstimate,
    };

    it('returns 422 when sourceSecret is missing', async () => {
      const { sourceSecret: _, ...body } = validDeposit;
      const res = await request(app).post('/api/stellar/pool/deposit').send(body);
      expect(res.status).toBe(422);
      expect(res.body.errors.map((e) => e.field)).toContain('sourceSecret');
    });

    it('returns 422 when sourceSecret is a public key (G…)', async () => {
      const res = await request(app)
        .post('/api/stellar/pool/deposit')
        .send({ ...validDeposit, sourceSecret: VALID_ACCOUNT });
      expect(res.status).toBe(422);
    });

    it('returns 422 when amountB is negative', async () => {
      const res = await request(app)
        .post('/api/stellar/pool/deposit')
        .send({ ...validDeposit, amountB: -5 });
      expect(res.status).toBe(422);
      expect(res.body.errors.map((e) => e.field)).toContain('amountB');
    });

    it('does not reach service when validation fails', async () => {
      const executeDeposit = (await import('../src/services/pool.js')).executeDeposit;
      vi.clearAllMocks();
      await request(app)
        .post('/api/stellar/pool/deposit')
        .send({ ...validDeposit, amountA: -100 });
      expect(executeDeposit).not.toHaveBeenCalled();
    });

    it('returns 200 with valid body', async () => {
      const res = await request(app).post('/api/stellar/pool/deposit').send(validDeposit);
      expect(res.status).toBe(200);
    });
  });

  // ── POST /withdraw ────────────────────────────────────────────────────────

  describe('POST /withdraw', () => {
    const validWithdraw = {
      sourceSecret: VALID_SECRET,
      ...validWithdrawEstimate,
    };

    it('returns 422 when sourceSecret is missing', async () => {
      const { sourceSecret: _, ...body } = validWithdraw;
      const res = await request(app).post('/api/stellar/pool/withdraw').send(body);
      expect(res.status).toBe(422);
      expect(res.body.errors.map((e) => e.field)).toContain('sourceSecret');
    });

    it('returns 422 when shares is zero', async () => {
      const res = await request(app)
        .post('/api/stellar/pool/withdraw')
        .send({ ...validWithdraw, shares: 0 });
      expect(res.status).toBe(422);
    });

    it('returns 422 when slippageTolerance is negative', async () => {
      const res = await request(app)
        .post('/api/stellar/pool/withdraw')
        .send({ ...validWithdraw, slippageTolerance: -0.5 });
      expect(res.status).toBe(422);
    });

    it('returns 200 with valid body', async () => {
      const res = await request(app).post('/api/stellar/pool/withdraw').send(validWithdraw);
      expect(res.status).toBe(200);
    });
  });
});
