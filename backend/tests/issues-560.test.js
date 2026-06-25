import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app, close } from '../src/server.js';
import * as StellarService from '../src/services/stellar.js';
import logger from '../src/config/logger.js';

vi.mock('../src/config/logger.js');

describe('Issue #560: Fee Estimation', () => {
  let server;

  beforeAll(async () => {
    server = app;
  });

  afterAll(async () => {
    await close();
  });

  it('should return fee estimate with base fee in stroops and XLM', async () => {
    const res = await request(server)
      .get('/api/stellar/fee-estimate');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('baseFeeBump');
    expect(res.body).toHaveProperty('baseFeeXLM');
    expect(res.body).toHaveProperty('recommendedFeeMultiplier');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('should return fee in stroops as integer', async () => {
    const res = await request(server)
      .get('/api/stellar/fee-estimate');

    expect(res.status).toBe(200);
    expect(Number.isInteger(res.body.baseFeeBump)).toBe(true);
    expect(res.body.baseFeeBump).toBeGreaterThan(0);
  });

  it('should return fee in XLM as string with proper format', async () => {
    const res = await request(server)
      .get('/api/stellar/fee-estimate');

    expect(res.status).toBe(200);
    expect(typeof res.body.baseFeeXLM).toBe('string');
    const feeNum = parseFloat(res.body.baseFeeXLM);
    expect(feeNum).toBeGreaterThan(0);
    expect(feeNum).toBeLessThan(1);
  });

  it('should have valid conversion between stroops and XLM', async () => {
    const res = await request(server)
      .get('/api/stellar/fee-estimate');

    expect(res.status).toBe(200);
    const expectedXLM = (res.body.baseFeeBump / 10000000).toFixed(7);
    expect(res.body.baseFeeXLM).toBe(expectedXLM);
  });

  it('should return recommended fee multiplier of 1', async () => {
    const res = await request(server)
      .get('/api/stellar/fee-estimate');

    expect(res.status).toBe(200);
    expect(res.body.recommendedFeeMultiplier).toBe(1);
  });

  it('should include valid ISO timestamp', async () => {
    const res = await request(server)
      .get('/api/stellar/fee-estimate');

    expect(res.status).toBe(200);
    expect(() => new Date(res.body.timestamp)).not.toThrow();
    expect(new Date(res.body.timestamp).getTime()).toBeLessThanOrEqual(new Date().getTime());
  });

  it('should be cached and fast on repeated calls', async () => {
    const start1 = Date.now();
    await request(server).get('/api/stellar/fee-estimate');
    const time1 = Date.now() - start1;

    const start2 = Date.now();
    const res = await request(server).get('/api/stellar/fee-estimate');
    const time2 = Date.now() - start2;

    expect(res.status).toBe(200);
    expect(time2).toBeLessThanOrEqual(time1 + 100);
  });
});
