import { describe, expect, it, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import contractRouter from '../src/routes/stellar/contract.js';

// ── App factory ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/stellar/contract', contractRouter);
  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_PUBLIC_KEY = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN';
const VALID_FUNCTION = 'get_market';

// ── #948 acceptance-criteria tests ───────────────────────────────────────────

describe('Soroban contract route — #948 sign-then-submit flow', () => {
  beforeEach(() => {
    delete process.env.STELLAR_CONTRACT_ADDRESS;
  });

  // ── Deprecation guard ─────────────────────────────────────────────────────

  it('rejects sourceSecret on POST /invoke with 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke')
      .send({ sourceSecret: 'S' + 'A'.repeat(55), signedTxXdr: 'dummy', functionName: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sourceSecret/);
    expect(res.body.error).toMatch(/no longer accepted/i);
  });

  it('rejects sourceSecret on POST /invoke/build with 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke/build')
      .send({
        sourceSecret: 'S' + 'A'.repeat(55),
        sourcePublicKey: VALID_PUBLIC_KEY,
        functionName: VALID_FUNCTION,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sourceSecret/);
  });

  it('rejects sourceSecret on POST /invoke/simulate with 400', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke/simulate')
      .send({
        sourceSecret: 'S' + 'A'.repeat(55),
        sourcePublicKey: VALID_PUBLIC_KEY,
        functionName: VALID_FUNCTION,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sourceSecret/);
  });

  // ── POST /invoke validation ───────────────────────────────────────────────

  it('POST /invoke returns 422 when signedTxXdr is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke')
      .send({ contractAddress: 'Cxxx' });

    expect(res.status).toBe(422);
    expect(res.body.errors).toBeDefined();
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toContain('signedTxXdr');
  });

  it('POST /invoke returns 503 when STELLAR_CONTRACT_ADDRESS is not set', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke')
      .send({ signedTxXdr: 'AAAA' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/STELLAR_CONTRACT_ADDRESS/);
  });

  // ── POST /invoke/build validation ────────────────────────────────────────

  it('POST /invoke/build returns 422 when functionName is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke/build')
      .send({ sourcePublicKey: VALID_PUBLIC_KEY });

    expect(res.status).toBe(422);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toContain('functionName');
  });

  it('POST /invoke/build returns 422 when sourcePublicKey is invalid', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke/build')
      .send({ functionName: VALID_FUNCTION, sourcePublicKey: 'not-a-key' });

    expect(res.status).toBe(422);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toContain('sourcePublicKey');
  });

  it('POST /invoke/build returns 503 when STELLAR_CONTRACT_ADDRESS is not set', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke/build')
      .send({ functionName: VALID_FUNCTION, sourcePublicKey: VALID_PUBLIC_KEY });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/STELLAR_CONTRACT_ADDRESS/);
  });

  // ── POST /invoke/simulate validation ─────────────────────────────────────

  it('POST /invoke/simulate returns 422 when functionName is missing', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke/simulate')
      .send({ sourcePublicKey: VALID_PUBLIC_KEY });

    expect(res.status).toBe(422);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toContain('functionName');
  });

  it('POST /invoke/simulate returns 503 when STELLAR_CONTRACT_ADDRESS is not set', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke/simulate')
      .send({ functionName: VALID_FUNCTION, sourcePublicKey: VALID_PUBLIC_KEY });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/STELLAR_CONTRACT_ADDRESS/);
  });

  // ── Testnet smoke test (skipped unless env vars present) ─────────────────

  it.skipIf(
    !process.env.TESTNET_SOURCE_PUBLIC_KEY || !process.env.STELLAR_CONTRACT_ADDRESS,
  )(
    'POST /invoke/simulate smoke test against testnet',
    async () => {
      process.env.STELLAR_CONTRACT_ADDRESS = process.env.STELLAR_CONTRACT_ADDRESS;
      const app = buildApp();
      const res = await request(app)
        .post('/api/stellar/contract/invoke/simulate')
        .send({
          sourcePublicKey: process.env.TESTNET_SOURCE_PUBLIC_KEY,
          functionName: process.env.TESTNET_CONTRACT_FUNCTION || 'get_treasury_balance',
          args: [],
        });

      // Either a successful simulation or a known failure — no unhandled 500 without details
      expect([200, 422, 500]).toContain(res.status);
      if (res.status === 500) {
        expect(res.body.message).toBeDefined();
      }
    },
  );
});
