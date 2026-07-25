/**
 * Tests for Issue #553: POST /api/analytics/client-errors endpoint
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

function makeApp(router) {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', router);
  return app;
}

describe('#553 POST /api/analytics/client-errors', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../src/db/client.js', () => ({
      default: {
        clientError: {
          create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
          groupBy: vi.fn().mockResolvedValue([]),
        },
      },
    }));
    vi.doMock('../src/middleware/auth.js', () => ({
      requireAuth: (_req, _res, next) => next(),
    }));
    vi.doMock('../src/analytics/index.js', () => ({
      aggregator: { dailySummary: vi.fn(), totals: vi.fn() },
      userBehavior: { getProfile: vi.fn() },
      fraudDetector: { analyze: vi.fn() },
      patternAnalyzer: { analyze: vi.fn() },
      dataExporter: { export: vi.fn() },
    }));
    const { default: router } = await import('../src/routes/analytics.js');
    app = makeApp(router);
  });

  it('accepts a valid error report and returns 204', async () => {
    const res = await request(app)
      .post('/api/analytics/client-errors')
      .send({ message: 'TypeError: Cannot read property', stack: 'at App.jsx:12', context: 'root' });
    expect(res.status).toBe(204);
  });

  it('returns 400 when message is missing', async () => {
    const res = await request(app)
      .post('/api/analytics/client-errors')
      .send({ stack: 'at App.jsx:12' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('scrubs Stellar secret keys from error messages before storing', async () => {
    const prisma = (await import('../src/db/client.js')).default;
    await request(app)
      .post('/api/analytics/client-errors')
      .send({ message: 'Secret: SCZANGBA5XNOJCE4ALXZCLJSPCXAZFM7PJCM77XAVGPBLR5QUQNLXJX bad' });

    const createCall = prisma.clientError.create.mock.calls[0][0];
    expect(createCall.data.message).not.toContain('SCZANGBA5XNOJCE4ALXZCLJSPCXAZFM7PJCM77XAVGPBLR5QUQNLXJX');
    expect(createCall.data.message).toContain('[REDACTED]');
  });

  it('stores an expiresAt 30 days in the future', async () => {
    const prisma = (await import('../src/db/client.js')).default;
    await request(app)
      .post('/api/analytics/client-errors')
      .send({ message: 'Test error' });

    const createCall = prisma.clientError.create.mock.calls[0][0];
    const diff = createCall.data.expiresAt - Date.now();
    // Should be ~30 days in ms (allow ±5s tolerance)
    expect(diff).toBeGreaterThan(30 * 24 * 60 * 60 * 1000 - 5000);
    expect(diff).toBeLessThan(30 * 24 * 60 * 60 * 1000 + 5000);
  });
});
