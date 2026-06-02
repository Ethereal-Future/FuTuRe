/**
 * Tests for issues #499-#502:
 *  - #499 Web Vitals endpoint
 *  - #500 KYC enforcement middleware
 *  - #501 Sanctions screening
 *  - #502 AML rules (structuring, velocity)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeApp(router, prefix = '/api') {
  const app = express();
  app.use(express.json());
  app.use(prefix, router);
  return app;
}

// ── #499 Web Vitals endpoint ──────────────────────────────────────────────────

describe('#499 POST /api/analytics/web-vitals', () => {
  let app;

  beforeEach(async () => {
    // Re-import to get a fresh in-memory store each test
    vi.resetModules();
    const { default: router } = await import('../src/routes/analytics.js');
    app = makeApp(router, '/api/analytics');
  });

  it('accepts a valid web-vitals payload and returns 204', async () => {
    const res = await request(app)
      .post('/api/analytics/web-vitals')
      .send({ name: 'LCP', value: 1200, rating: 'good', url: 'https://example.com', timestamp: Date.now() });
    expect(res.status).toBe(204);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/analytics/web-vitals')
      .send({ name: 'LCP' }); // missing value and rating
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('dashboard returns p75 aggregates (requires auth)', async () => {
    // Mock requireAuth to pass through
    vi.doMock('../src/middleware/auth.js', () => ({
      requireAuth: (_req, _res, next) => next(),
    }));
    vi.resetModules();
    const { default: router2 } = await import('../src/routes/analytics.js');
    const app2 = makeApp(router2, '/api/analytics');

    // Seed some data
    await request(app2).post('/api/analytics/web-vitals').send({ name: 'LCP', value: 1000, rating: 'good', timestamp: 1000 });
    await request(app2).post('/api/analytics/web-vitals').send({ name: 'LCP', value: 2000, rating: 'needs-improvement', timestamp: 2000 });
    await request(app2).post('/api/analytics/web-vitals').send({ name: 'LCP', value: 3000, rating: 'poor', timestamp: 3000 });
    await request(app2).post('/api/analytics/web-vitals').send({ name: 'LCP', value: 4000, rating: 'poor', timestamp: 4000 });

    const res = await request(app2).get('/api/analytics/web-vitals/dashboard').set('Authorization', 'Bearer token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('LCP');
    expect(typeof res.body.LCP).toBe('number');
  });
});

// ── #500 requireKYC middleware ────────────────────────────────────────────────

describe('#500 requireKYC middleware', () => {
  const { verifyToken } = await import('../src/auth/tokens.js').catch(() => ({ verifyToken: () => ({ id: 'user-1' }) }));

  beforeEach(() => {
    vi.resetModules();
  });

  it('passes through when amount is below threshold', async () => {
    vi.doMock('../src/db/client.js', () => ({ default: { kYCRecord: { findUnique: vi.fn() } } }));
    vi.doMock('../src/auth/tokens.js', () => ({ verifyToken: () => ({ id: 'user-1' }) }));
    const { requireKYC } = await import('../src/middleware/kyc.js');

    const app = express();
    app.use(express.json());
    app.post('/pay', requireKYC, (_req, res) => res.json({ ok: true }));

    const res = await request(app).post('/pay').send({ amount: '500' });
    expect(res.status).toBe(200);
  });

  it('returns 403 KYC_REQUIRED when amount exceeds threshold and KYC not approved', async () => {
    vi.doMock('../src/db/client.js', () => ({
      default: { kYCRecord: { findUnique: vi.fn().mockResolvedValue({ status: 'PENDING' }) } },
    }));
    vi.doMock('../src/auth/tokens.js', () => ({ verifyToken: () => ({ id: 'user-1' }) }));
    const { requireKYC } = await import('../src/middleware/kyc.js');

    const app = express();
    app.use(express.json());
    app.post('/pay', requireKYC, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .post('/pay')
      .set('Authorization', 'Bearer faketoken')
      .send({ amount: '2000' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('KYC_REQUIRED');
    expect(res.body.kycStatus).toBe('PENDING');
  });

  it('passes through when KYC is APPROVED', async () => {
    vi.doMock('../src/db/client.js', () => ({
      default: { kYCRecord: { findUnique: vi.fn().mockResolvedValue({ status: 'APPROVED' }) } },
    }));
    vi.doMock('../src/auth/tokens.js', () => ({ verifyToken: () => ({ id: 'user-1' }) }));
    const { requireKYC } = await import('../src/middleware/kyc.js');

    const app = express();
    app.use(express.json());
    app.post('/pay', requireKYC, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .post('/pay')
      .set('Authorization', 'Bearer faketoken')
      .send({ amount: '2000' });
    expect(res.status).toBe(200);
  });

  it('returns 403 with kycStatus NONE when no KYC record exists', async () => {
    vi.doMock('../src/db/client.js', () => ({
      default: { kYCRecord: { findUnique: vi.fn().mockResolvedValue(null) } },
    }));
    vi.doMock('../src/auth/tokens.js', () => ({ verifyToken: () => ({ id: 'user-1' }) }));
    const { requireKYC } = await import('../src/middleware/kyc.js');

    const app = express();
    app.use(express.json());
    app.post('/pay', requireKYC, (_req, res) => res.json({ ok: true }));

    const res = await request(app)
      .post('/pay')
      .set('Authorization', 'Bearer faketoken')
      .send({ amount: '5000' });
    expect(res.status).toBe(403);
    expect(res.body.kycStatus).toBe('NONE');
  });
});

// ── #501 Sanctions screening ──────────────────────────────────────────────────

describe('#501 sanctionsChecker', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.SANCTIONS_API_KEY;
  });

  it('returns hit:false when no API key is configured (warn-and-pass)', async () => {
    const { default: checker } = await import('../src/compliance/sanctionsChecker.js');
    const result = await checker.check('Jane Doe', 'US');
    expect(result.hit).toBe(false);
  });

  it('returns hit:true when API responds with a match', async () => {
    process.env.SANCTIONS_API_KEY = 'test-key';
    vi.doMock('../src/compliance/sanctionsChecker.js', () => ({
      default: {
        check: vi.fn().mockResolvedValue({
          hit: true,
          reason: 'Matched sanctions entry: Bad Actor (score: 95, lists: SDN)',
          source: 'SDN',
        }),
      },
    }));
    const { default: checker } = await import('../src/compliance/sanctionsChecker.js');
    const result = await checker.check('Bad Actor', 'IR');
    expect(result.hit).toBe(true);
    expect(result.reason).toMatch(/SDN/);
  });

  it('returns hit:false when API responds with no matches', async () => {
    process.env.SANCTIONS_API_KEY = 'test-key';
    vi.doMock('../src/compliance/sanctionsChecker.js', () => ({
      default: { check: vi.fn().mockResolvedValue({ hit: false }) },
    }));
    const { default: checker } = await import('../src/compliance/sanctionsChecker.js');
    const result = await checker.check('Clean Person', 'US');
    expect(result.hit).toBe(false);
  });
});

// ── #502 AML rules ────────────────────────────────────────────────────────────

describe('#502 amlMonitor', () => {
  const mockPrisma = {
    aMLAlert: { create: vi.fn().mockResolvedValue({}) },
  };

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../src/db/client.js', () => ({ default: mockPrisma }));
    vi.doMock('../src/compliance/riskScorer.js', () => ({
      default: { scoreTransaction: vi.fn().mockResolvedValue({ score: 50, level: 'MEDIUM' }) },
    }));
    vi.doMock('../src/compliance/complianceAudit.js', () => ({
      default: { log: vi.fn().mockResolvedValue({}) },
    }));
    vi.doMock('../src/compliance/kycCollector.js', () => ({
      default: { isVerified: vi.fn().mockResolvedValue(true) },
    }));
  });

  it('flags LARGE_TX for amount >= 10000', async () => {
    const { default: monitor } = await import('../src/compliance/amlMonitor.js');
    const tx = { id: 'tx-1', senderId: 'u1', amount: '15000', createdAt: new Date().toISOString() };
    const { alerts } = await monitor.screenTransaction(tx, []);
    expect(alerts.some(a => a.ruleId === 'LARGE_TX')).toBe(true);
  });

  it('does not flag LARGE_TX for amount < 10000', async () => {
    const { default: monitor } = await import('../src/compliance/amlMonitor.js');
    const tx = { id: 'tx-2', senderId: 'u1', amount: '500', createdAt: new Date().toISOString() };
    const { alerts } = await monitor.screenTransaction(tx, []);
    expect(alerts.some(a => a.ruleId === 'LARGE_TX')).toBe(false);
  });

  it('flags STRUCTURING when >3 transactions below $1000 in 24h', async () => {
    const { default: monitor } = await import('../src/compliance/amlMonitor.js');
    const now = new Date();
    const history = Array.from({ length: 3 }, (_, i) => ({
      id: `h-${i}`, senderId: 'u2', amount: '900',
      createdAt: new Date(now - (i + 1) * 60 * 60 * 1000).toISOString(),
    }));
    const tx = { id: 'tx-3', senderId: 'u2', amount: '950', createdAt: now.toISOString() };
    const { alerts } = await monitor.screenTransaction(tx, history);
    expect(alerts.some(a => a.ruleId === 'STRUCTURING')).toBe(true);
  });

  it('does not flag STRUCTURING when count is below threshold', async () => {
    const { default: monitor } = await import('../src/compliance/amlMonitor.js');
    const now = new Date();
    const history = [{ id: 'h-0', senderId: 'u3', amount: '900', createdAt: new Date(now - 3600000).toISOString() }];
    const tx = { id: 'tx-4', senderId: 'u3', amount: '950', createdAt: now.toISOString() };
    const { alerts } = await monitor.screenTransaction(tx, history);
    expect(alerts.some(a => a.ruleId === 'STRUCTURING')).toBe(false);
  });

  it('flags VELOCITY when total sent in 24h exceeds $10000', async () => {
    const { default: monitor } = await import('../src/compliance/amlMonitor.js');
    const now = new Date();
    const history = [
      { id: 'h-1', senderId: 'u4', amount: '6000', createdAt: new Date(now - 3600000).toISOString() },
      { id: 'h-2', senderId: 'u4', amount: '3000', createdAt: new Date(now - 7200000).toISOString() },
    ];
    const tx = { id: 'tx-5', senderId: 'u4', amount: '2000', createdAt: now.toISOString() };
    const { alerts } = await monitor.screenTransaction(tx, history);
    expect(alerts.some(a => a.ruleId === 'VELOCITY')).toBe(true);
  });

  it('does not flag VELOCITY when total is within limit', async () => {
    const { default: monitor } = await import('../src/compliance/amlMonitor.js');
    const now = new Date();
    const history = [{ id: 'h-1', senderId: 'u5', amount: '1000', createdAt: new Date(now - 3600000).toISOString() }];
    const tx = { id: 'tx-6', senderId: 'u5', amount: '500', createdAt: now.toISOString() };
    const { alerts } = await monitor.screenTransaction(tx, history);
    expect(alerts.some(a => a.ruleId === 'VELOCITY')).toBe(false);
  });

  it('persists AMLAlert records to DB when alerts are triggered', async () => {
    mockPrisma.aMLAlert.create.mockClear();
    const { default: monitor } = await import('../src/compliance/amlMonitor.js');
    const tx = { id: 'tx-7', senderId: 'u6', amount: '12000', createdAt: new Date().toISOString() };
    await monitor.screenTransaction(tx, []);
    expect(mockPrisma.aMLAlert.create).toHaveBeenCalled();
    const call = mockPrisma.aMLAlert.create.mock.calls[0][0];
    expect(call.data.transactionId).toBe('tx-7');
    expect(call.data.ruleId).toBe('LARGE_TX');
  });

  it('returns flagged:false and no alerts for a clean transaction', async () => {
    const { default: monitor } = await import('../src/compliance/amlMonitor.js');
    const tx = { id: 'tx-8', senderId: 'u7', amount: '50', createdAt: new Date().toISOString() };
    const result = await monitor.screenTransaction(tx, []);
    expect(result.flagged).toBe(false);
    expect(result.alerts).toHaveLength(0);
  });
});
