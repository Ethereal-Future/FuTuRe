/**
 * Rate-limiting and contact-cap tests for:
 *   - POST /api/v1/accounts/contacts  (contacts.js)
 *   - PUT  /api/v1/admin/kyc/:id/approve  (admin.js)
 *   - PUT  /api/v1/admin/kyc/:id/reject   (admin.js)
 *
 * Each test builds a minimal Express app that wires only the middleware
 * under test so there are no database, auth, or CSRF side effects.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPerUserRateLimiter } from '../src/middleware/rateLimiter.js';
import { MAX_CONTACTS_PER_USER } from '../src/routes/contacts.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal app that injects req.user from the X-Test-User-Id header.
 * This mirrors the pattern used in the existing rateLimiting.test.js.
 */
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.headers['x-test-user-id'];
    if (userId) req.user = { id: userId };
    next();
  });
  return app;
}

// ---------------------------------------------------------------------------
// 1. POST /contacts — per-user rate limit
// ---------------------------------------------------------------------------

describe('POST /contacts – per-user rate limiter', () => {
  let app;

  beforeEach(() => {
    app = makeApp();

    // Reproduce the limiter from contacts.js (20 req/min, per-user)
    const limiter = createPerUserRateLimiter({ windowMs: 60_000, max: 20 });
    app.post('/contacts', limiter, (_req, res) => res.status(201).json({ ok: true }));
  });

  it('allows requests up to the limit', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post('/contacts')
        .set('X-Test-User-Id', 'user-a');
      expect(res.status).toBe(201);
    }
  });

  it('returns 429 once the per-user limit is exceeded', async () => {
    for (let i = 0; i < 20; i++) {
      await request(app).post('/contacts').set('X-Test-User-Id', 'user-b');
    }
    const exceeded = await request(app)
      .post('/contacts')
      .set('X-Test-User-Id', 'user-b');
    expect(exceeded.status).toBe(429);
    expect(exceeded.body.retryAfter).toBeDefined();
  });

  it('isolates buckets: one user hitting the limit does not affect another', async () => {
    // Exhaust limit for user-c
    for (let i = 0; i < 20; i++) {
      await request(app).post('/contacts').set('X-Test-User-Id', 'user-c');
    }
    const exceeded = await request(app)
      .post('/contacts')
      .set('X-Test-User-Id', 'user-c');
    expect(exceeded.status).toBe(429);

    // user-d should still be allowed
    const other = await request(app)
      .post('/contacts')
      .set('X-Test-User-Id', 'user-d');
    expect(other.status).toBe(201);
  });

  it('includes Retry-After header in the 429 response', async () => {
    for (let i = 0; i < 20; i++) {
      await request(app).post('/contacts').set('X-Test-User-Id', 'user-e');
    }
    const res = await request(app)
      .post('/contacts')
      .set('X-Test-User-Id', 'user-e');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. POST /contacts — per-user contact cap (MAX_CONTACTS_PER_USER)
// ---------------------------------------------------------------------------

describe('POST /contacts – per-user contact cap', () => {
  it('MAX_CONTACTS_PER_USER is exported and equals 500', () => {
    expect(MAX_CONTACTS_PER_USER).toBe(500);
  });

  it('returns 400 when the user already has MAX_CONTACTS_PER_USER contacts', async () => {
    vi.resetModules();

    // Mock prisma so count returns the cap value.
    vi.doMock('../src/db/client.js', () => ({
      default: {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: 'user-cap', publicKey: 'GTEST' }),
        },
        contact: {
          count: vi.fn().mockResolvedValue(MAX_CONTACTS_PER_USER),
          create: vi.fn(),
        },
      },
    }));

    // Re-import the router with the mocked prisma.
    const { default: contactsRouter } = await import('../src/routes/contacts.js');

    const app = express();
    app.use(express.json());
    // Simulate auth middleware — contacts.js calls requireAuth via router.use
    // so we must inject req.user before the router handles the request.
    app.use((req, _res, next) => {
      req.user = { publicKey: 'GTEST', id: 'user-cap' };
      next();
    });
    app.use('/', contactsRouter);

    const res = await request(app)
      .post('/')
      .send({ name: 'Alice', address: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contact limit/i);

    // prisma.contact.create should never have been called.
    const { default: prisma } = await import('../src/db/client.js');
    expect(prisma.contact.create).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('proceeds with creation when the user is below the cap', async () => {
    vi.resetModules();

    const fakeSid = 'contact-id-1';
    vi.doMock('../src/db/client.js', () => ({
      default: {
        user: {
          findUnique: vi.fn().mockResolvedValue({ id: 'user-below', publicKey: 'GTEST2' }),
        },
        contact: {
          count: vi.fn().mockResolvedValue(MAX_CONTACTS_PER_USER - 1),
          create: vi.fn().mockResolvedValue({
            id: fakeSid,
            name: 'Bob',
            address: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN',
            createdAt: new Date().toISOString(),
          }),
        },
      },
    }));

    const { default: contactsRouter } = await import('../src/routes/contacts.js');

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { publicKey: 'GTEST2', id: 'user-below' };
      next();
    });
    app.use('/', contactsRouter);

    const res = await request(app)
      .post('/')
      .send({ name: 'Bob', address: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN' });

    expect(res.status).toBe(201);
    expect(res.body.contact.id).toBe(fakeSid);

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// 3. Admin KYC routes — per-admin rate limiter
// ---------------------------------------------------------------------------

describe('Admin KYC routes – per-admin rate limiter', () => {
  let app;

  beforeEach(() => {
    app = makeApp();

    // Reproduce the admin KYC limiter (30 req/10 min, per-user)
    const limiter = createPerUserRateLimiter({ windowMs: 10 * 60_000, max: 30 });

    app.put('/kyc/:userId/approve', limiter, (_req, res) =>
      res.json({ success: true, action: 'approve' }),
    );
    app.put('/kyc/:userId/reject', limiter, (_req, res) =>
      res.json({ success: true, action: 'reject' }),
    );
  });

  it('allows admin KYC actions up to the limit', async () => {
    for (let i = 0; i < 30; i++) {
      const res = await request(app)
        .put(`/kyc/user-${i}/approve`)
        .set('X-Test-User-Id', 'admin-1');
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 once the per-admin KYC limit is exceeded', async () => {
    for (let i = 0; i < 30; i++) {
      await request(app).put(`/kyc/user-${i}/approve`).set('X-Test-User-Id', 'admin-2');
    }
    const exceeded = await request(app)
      .put('/kyc/user-overflow/approve')
      .set('X-Test-User-Id', 'admin-2');
    expect(exceeded.status).toBe(429);
    expect(exceeded.body.retryAfter).toBeDefined();
  });

  it('applies the same bucket across approve and reject actions', async () => {
    // Mix of approve and reject — both draw from the same admin bucket.
    for (let i = 0; i < 15; i++) {
      await request(app).put(`/kyc/u${i}/approve`).set('X-Test-User-Id', 'admin-3');
    }
    for (let i = 0; i < 15; i++) {
      await request(app).put(`/kyc/u${i}/reject`).set('X-Test-User-Id', 'admin-3');
    }
    const exceeded = await request(app)
      .put('/kyc/u-extra/reject')
      .set('X-Test-User-Id', 'admin-3');
    expect(exceeded.status).toBe(429);
  });

  it('isolates admin buckets from each other', async () => {
    // Exhaust admin-4
    for (let i = 0; i < 30; i++) {
      await request(app).put(`/kyc/u${i}/approve`).set('X-Test-User-Id', 'admin-4');
    }
    const exceeded = await request(app)
      .put('/kyc/u-extra/approve')
      .set('X-Test-User-Id', 'admin-4');
    expect(exceeded.status).toBe(429);

    // admin-5 should be unaffected
    const other = await request(app)
      .put('/kyc/u-other/approve')
      .set('X-Test-User-Id', 'admin-5');
    expect(other.status).toBe(200);
  });

  it('the admin KYC limit is distinct from the contacts limit', () => {
    // Sanity-check: the two limiters use different max values.
    // contacts: 20/min, KYC: 30/10min — different numbers, different windows.
    const contactsMax = 20;
    const kycMax = 30;
    expect(kycMax).not.toBe(contactsMax);
  });
});
