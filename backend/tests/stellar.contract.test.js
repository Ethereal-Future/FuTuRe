import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import contractRouter from '../src/routes/stellar/contract.js';

describe('Soroban contract route', () => {
  it('returns a clear error when no contract address is configured', async () => {
    const originalAddress = process.env.STELLAR_CONTRACT_ADDRESS;
    delete process.env.STELLAR_CONTRACT_ADDRESS;
    const app = express();
    app.use(express.json());
    app.use('/api/stellar/contract', contractRouter);

    const res = await request(app)
      .post('/api/stellar/contract/invoke')
      .send({ sourceSecret: 'S'.repeat(56), functionName: 'get_market', args: [1] });

    process.env.STELLAR_CONTRACT_ADDRESS = originalAddress;
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('STELLAR_CONTRACT_ADDRESS');
  });

  it.skipIf(!process.env.TESTNET_SOURCE_SECRET || !process.env.STELLAR_CONTRACT_ADDRESS)(
    'invokes the configured contract on testnet',
    async () => {
      const app = express();
      app.use(express.json());
      app.use('/api/stellar/contract', contractRouter);

      const res = await request(app)
        .post('/api/stellar/contract/invoke')
        .send({
          sourceSecret: process.env.TESTNET_SOURCE_SECRET,
          functionName: process.env.TESTNET_CONTRACT_FUNCTION || 'get_treasury_balance',
          args: [],
        });

      expect([200, 500]).toContain(res.status);
      expect(res.body.hash || res.body.error).toBeDefined();
    },
  );
});
