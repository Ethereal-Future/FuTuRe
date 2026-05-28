import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../tests/helpers/app.js';
import { ApiTestFramework } from '../../testing/api-testing.js';

let framework;

beforeAll(() => {
  framework = new ApiTestFramework(app);

  // Register contracts
  framework.defineContract('health', {
    method: 'GET',
    path: '/health',
    responseSchema: {
      required: ['status'],
      types: { status: 'string' },
    },
  });

  framework.defineContract('create-account', {
    method: 'POST',
    path: '/api/stellar/account',
    responseSchema: {
      required: ['publicKey', 'secretKey'],
      types: { publicKey: 'string', secretKey: 'string' },
    },
  });
});

describe('API Testing Framework', () => {
  describe('Contract validation', () => {
    it('validates health endpoint contract', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      const { valid, errors } = framework.validateContract('health', res.body);
      expect(errors).toEqual([]);
      expect(valid).toBe(true);
    });

    it('detects missing required fields in contract', () => {
      const { valid, errors } = framework.validateContract('health', {});
      expect(valid).toBe(false);
      expect(errors).toContain('Missing required field: status');
    });

    it('detects wrong field types in contract', () => {
      const { valid, errors } = framework.validateContract('health', { status: 42 });
      expect(valid).toBe(false);
      expect(errors.some((e) => e.includes('"status"'))).toBe(true);
    });
  });

  describe('API mocking', () => {
    it('registers and retrieves a mock', () => {
      framework.mock('/api/stellar/rate', { rate: 0.12, currency: 'USD' });
      const mock = framework.mocks.get('/api/stellar/rate');
      expect(mock).toEqual({ rate: 0.12, currency: 'USD' });
    });
  });

  describe('Performance assertions', () => {
    it('health endpoint responds within 500 ms', async () => {
      const start = Date.now();
      await request(app).get('/health');
      const duration = Date.now() - start;
      const passed = framework.assertPerformance(duration, 500, 'GET /health');
      expect(passed).toBe(true);
    });

    it('records a performance failure when over budget', () => {
      const passed = framework.assertPerformance(600, 200, 'slow-endpoint');
      expect(passed).toBe(false);
    });
  });

  describe('Test reporting', () => {
    it('generates a report with correct counts', () => {
      framework.record('test-a', true);
      framework.record('test-b', false);
      const report = framework.report();
      expect(report.total).toBeGreaterThanOrEqual(2);
      expect(report.failed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Security headers', () => {
    it('health endpoint does not expose server internals', async () => {
      const res = await request(app).get('/health');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });
});
