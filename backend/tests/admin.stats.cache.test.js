/**
 * Tests for GET /api/v1/admin/stats caching behaviour.
 *
 * Covers:
 *  1. First request (cache MISS) hits all five Prisma count queries and
 *     returns the correct shape including generatedAt.
 *  2. Second request within the TTL window (cache HIT) does NOT re-run
 *     the Prisma queries — they are called exactly once across both requests.
 *  3. X-Cache header is MISS on the first call and HIT on the second.
 *  4. Cached response body is identical to the original (generatedAt preserved).
 *  5. generatedAt is a valid ISO-8601 date string.
 *  6. After the cache entry expires (TTL passes), the next request is a
 *     MISS and re-queries Prisma.
 *  7. The exported ADMIN_STATS_TTL_SECONDS constant equals 30.
 *  8. A 500 response from the handler is NOT cached.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Shared mock factories
// ---------------------------------------------------------------------------

const MOCK_COUNTS = {
  totalUsers: 42,
  totalTransactions: 100,
  activeStreams: 5,
  pendingKYC: 3,
  openAMLAlerts: 1,
};

/**
 * Build a fresh Express app wiring the admin router with all its dependencies
 * mocked.  Returns the app and a reference to the Prisma user.count spy so
 * tests can assert call counts.
 *
 * @param {{ cacheStore?: Map }} options
 */
async function makeAdminApp({ cacheStore } = {}) {
  vi.resetModules();

  // ── In-memory cache stand-in ──────────────────────────────────────────────
  // We replace appCache with a simple Map so we can control TTL behaviour
  // without a real Redis connection.
  const store = cacheStore ?? new Map();

  vi.doMock('../src/cache/appCache.js', () => ({
    cacheGet: vi.fn(async (key) => store.get(key) ?? null),
    cacheSet: vi.fn(async (key, value) => store.set(key, value)),
    cacheDel: vi.fn(async (key) => store.delete(key)),
    invalidateBalance: vi.fn(),
    keys: {},
    TTL: { BALANCE: 30, RATE: 60, FEE_STATS: 120 },
    analytics: { recordHit: vi.fn(), recordMiss: vi.fn(), recordSet: vi.fn(), recordDelete: vi.fn() },
    monitor: { recordOperation: vi.fn() },
  }));

  // ── Prisma mock ────────────────────────────────────────────────────────────
  const countSpy = vi.fn()
    .mockResolvedValueOnce(MOCK_COUNTS.totalUsers)
    .mockResolvedValueOnce(MOCK_COUNTS.totalTransactions)
    .mockResolvedValueOnce(MOCK_COUNTS.activeStreams)
    .mockResolvedValueOnce(MOCK_COUNTS.pendingKYC)
    .mockResolvedValueOnce(MOCK_COUNTS.openAMLAlerts)
    // Second round (if called again after cache miss)
    .mockResolvedValueOnce(MOCK_COUNTS.totalUsers + 1)
    .mockResolvedValueOnce(MOCK_COUNTS.totalTransactions + 1)
    .mockResolvedValueOnce(MOCK_COUNTS.activeStreams + 1)
    .mockResolvedValueOnce(MOCK_COUNTS.pendingKYC + 1)
    .mockResolvedValueOnce(MOCK_COUNTS.openAMLAlerts + 1);

  vi.doMock('../src/db/client.js', () => ({
    default: {
      user: { count: countSpy },
      transaction: { count: countSpy },
      paymentStream: { count: countSpy },
      kYCRecord: { count: countSpy },
      aMLAlert: { count: countSpy },
    },
  }));

  // ── Auth mock ──────────────────────────────────────────────────────────────
  vi.doMock('../src/middleware/adminAuth.js', () => ({
    requireAdmin: (req, _res, next) => {
      req.user = { sub: 'admin-1', role: 'ADMIN' };
      next();
    },
  }));

  vi.doMock('../src/db/adminAuditLog.js', () => ({ logAdminAction: vi.fn() }));
  vi.doMock('../src/middleware/rateLimiter.js', () => ({
    createPerUserRateLimiter: () => (_req, _res, next) => next(),
    createRateLimiter: () => (_req, _res, next) => next(),
  }));

  const { default: adminRouter } = await import('../src/routes/admin.js');

  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  return { app, countSpy, store };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /admin/stats – caching', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. First request hits DB and returns correct shape
  it('first request (MISS) queries all five Prisma counts and returns stats', async () => {
    const { app, countSpy } = await makeAdminApp();

    const res = await request(app).get('/admin/stats');

    expect(res.status).toBe(200);
    expect(res.body.totalUsers).toBe(MOCK_COUNTS.totalUsers);
    expect(res.body.totalTransactions).toBe(MOCK_COUNTS.totalTransactions);
    expect(res.body.activeStreams).toBe(MOCK_COUNTS.activeStreams);
    expect(res.body.pendingKYC).toBe(MOCK_COUNTS.pendingKYC);
    expect(res.body.openAMLAlerts).toBe(MOCK_COUNTS.openAMLAlerts);
    // All five counts were called exactly once
    expect(countSpy).toHaveBeenCalledTimes(5);
  });

  // 2. Second request within TTL does NOT re-query Prisma
  it('second request within TTL (HIT) does not re-run Prisma queries', async () => {
    const store = new Map();
    const { app, countSpy } = await makeAdminApp({ cacheStore: store });

    // First call populates the cache
    await request(app).get('/admin/stats');
    expect(countSpy).toHaveBeenCalledTimes(5);

    // Second call — cache is warm, Prisma must NOT be called again
    const res2 = await request(app).get('/admin/stats');
    expect(res2.status).toBe(200);
    expect(countSpy).toHaveBeenCalledTimes(5); // still 5, not 10
  });

  // 3. X-Cache header
  it('sets X-Cache: MISS on first request and HIT on second', async () => {
    const store = new Map();
    const { app } = await makeAdminApp({ cacheStore: store });

    const res1 = await request(app).get('/admin/stats');
    expect(res1.headers['x-cache']).toBe('MISS');

    const res2 = await request(app).get('/admin/stats');
    expect(res2.headers['x-cache']).toBe('HIT');
  });

  // 4. Cached body is identical to the original
  it('cached response body matches the original response body', async () => {
    const store = new Map();
    const { app } = await makeAdminApp({ cacheStore: store });

    const res1 = await request(app).get('/admin/stats');
    const res2 = await request(app).get('/admin/stats');

    // Every field except generatedAt must match
    const { generatedAt: _g1, ...body1 } = res1.body;
    const { generatedAt: _g2, ...body2 } = res2.body;
    expect(body2).toEqual(body1);
    // generatedAt is preserved in the cached copy
    expect(res2.body.generatedAt).toBe(res1.body.generatedAt);
  });

  // 5. generatedAt is a valid ISO-8601 string
  it('response includes a valid ISO-8601 generatedAt timestamp', async () => {
    const { app } = await makeAdminApp();
    const res = await request(app).get('/admin/stats');
    expect(res.body.generatedAt).toBeDefined();
    expect(() => new Date(res.body.generatedAt).toISOString()).not.toThrow();
    expect(new Date(res.body.generatedAt).toISOString()).toBe(res.body.generatedAt);
  });

  // 6. After TTL expires (cache cleared manually), next request re-queries DB
  it('re-queries Prisma after the cache entry is evicted', async () => {
    const store = new Map();
    const { app, countSpy } = await makeAdminApp({ cacheStore: store });

    // Populate cache
    await request(app).get('/admin/stats');
    expect(countSpy).toHaveBeenCalledTimes(5);

    // Simulate TTL expiry by clearing the store
    store.clear();

    // Next request should be a MISS and re-query DB
    const res = await request(app).get('/admin/stats');
    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(countSpy).toHaveBeenCalledTimes(10); // 5 original + 5 after eviction
  });

  // 7. Exported TTL constant
  it('ADMIN_STATS_TTL_SECONDS is 30', async () => {
    vi.resetModules();
    vi.doMock('../src/cache/appCache.js', () => ({
      cacheGet: vi.fn(async () => null),
      cacheSet: vi.fn(),
    }));
    vi.doMock('../src/db/client.js', () => ({ default: {} }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdmin: vi.fn() }));
    vi.doMock('../src/db/adminAuditLog.js', () => ({ logAdminAction: vi.fn() }));
    vi.doMock('../src/middleware/rateLimiter.js', () => ({
      createPerUserRateLimiter: () => (_r, _s, n) => n(),
    }));
    const { ADMIN_STATS_TTL_SECONDS } = await import('../src/routes/admin.js');
    expect(ADMIN_STATS_TTL_SECONDS).toBe(30);
  });

  // 8. Error responses are not cached
  it('does not cache a 500 error response', async () => {
    vi.resetModules();

    const store = new Map();
    vi.doMock('../src/cache/appCache.js', () => ({
      cacheGet: vi.fn(async (key) => store.get(key) ?? null),
      cacheSet: vi.fn(async (key, value) => store.set(key, value)),
      cacheDel: vi.fn(),
      invalidateBalance: vi.fn(),
      keys: {},
      TTL: {},
      analytics: { recordHit: vi.fn(), recordMiss: vi.fn(), recordSet: vi.fn(), recordDelete: vi.fn() },
      monitor: { recordOperation: vi.fn() },
    }));

    // Make all count calls throw so the handler returns 500
    const throwingCount = vi.fn().mockRejectedValue(new Error('DB error'));
    vi.doMock('../src/db/client.js', () => ({
      default: {
        user: { count: throwingCount },
        transaction: { count: throwingCount },
        paymentStream: { count: throwingCount },
        kYCRecord: { count: throwingCount },
        aMLAlert: { count: throwingCount },
      },
    }));

    vi.doMock('../src/middleware/adminAuth.js', () => ({
      requireAdmin: (_r, _s, next) => next(),
    }));
    vi.doMock('../src/db/adminAuditLog.js', () => ({ logAdminAction: vi.fn() }));
    vi.doMock('../src/middleware/rateLimiter.js', () => ({
      createPerUserRateLimiter: () => (_r, _s, n) => n(),
    }));

    const { default: adminRouter } = await import('../src/routes/admin.js');
    const app = express();
    app.use(express.json());
    app.use('/admin', adminRouter);

    const res = await request(app).get('/admin/stats');
    expect(res.status).toBe(500);

    // Cache must remain empty — the cacheSet in the middleware only fires
    // for statusCode < 400, so a 500 must not populate the store.
    expect(store.size).toBe(0);
  });
});
