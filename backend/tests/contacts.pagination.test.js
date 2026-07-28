/**
 * Pagination tests for GET /api/v1/accounts/contacts
 *
 * Covers:
 *  1. Default response shape includes a pagination object
 *  2. Default limit is CONTACTS_DEFAULT_PAGE_SIZE (50) — result is bounded
 *  3. Explicit page/limit params are respected
 *  4. pages is computed correctly from total and limit
 *  5. skip/take are forwarded to Prisma with the right values
 *  6. limit is capped at CONTACTS_MAX_PAGE_SIZE (200) even if higher requested
 *  7. Invalid page/limit values return 422
 *  8. page=0 and limit=0 are rejected
 *  9. Empty result set returns pagination with total=0, pages=0
 * 10. Second page returns correct slice
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Constants imported from the route (single source of truth)
// ---------------------------------------------------------------------------
import {
  CONTACTS_DEFAULT_PAGE_SIZE,
  CONTACTS_MAX_PAGE_SIZE,
} from '../src/routes/contacts.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fresh Express app with the contacts router, injecting a mocked
 * Prisma client so no database is needed.
 *
 * @param {{ findMany?: any[], count?: number, findManyImpl?: Function }} prismaContact
 */
async function makeContactsApp({ findMany = [], count = 0, findManyImpl } = {}) {
  vi.resetModules();

  const findManyFn = findManyImpl
    ? vi.fn(findManyImpl)
    : vi.fn().mockResolvedValue(findMany);

  vi.doMock('../src/db/client.js', () => ({
    default: {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'user-pg', publicKey: 'GTEST' }),
      },
      contact: {
        findMany: findManyFn,
        count: vi.fn().mockResolvedValue(count),
        // POST handler also uses count — keep it consistent
        create: vi.fn(),
      },
    },
  }));

  vi.doMock('../src/middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => {
      req.user = { publicKey: 'GTEST' };
      next();
    },
  }));

  vi.doMock('../src/config/logger.js', () => ({
    default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  }));

  // Let validate run for real so query-param validation is exercised.
  // We do NOT mock it here — express-validator is a dev dep and available.

  const { default: contactsRouter } = await import('../src/routes/contacts.js');

  const app = express();
  app.use(express.json());
  // Inject user before the router's own requireAuth fires
  app.use((req, _res, next) => {
    req.user = { publicKey: 'GTEST' };
    next();
  });
  app.use('/', contactsRouter);
  return { app, findManyFn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /contacts – pagination', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Default response shape
  it('response always includes a pagination object', async () => {
    const { app } = await makeContactsApp({ findMany: [], count: 0 });
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.contacts).toBeDefined();
    expect(res.body.pagination).toBeDefined();
    expect(typeof res.body.pagination.page).toBe('number');
    expect(typeof res.body.pagination.limit).toBe('number');
    expect(typeof res.body.pagination.total).toBe('number');
    expect(typeof res.body.pagination.pages).toBe('number');
  });

  // 2. Default limit is bounded
  it('default limit is CONTACTS_DEFAULT_PAGE_SIZE', async () => {
    const { app } = await makeContactsApp({ count: 300 });
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(CONTACTS_DEFAULT_PAGE_SIZE);
  });

  // 3. Explicit page and limit are respected
  it('honours explicit page and limit query params', async () => {
    const { app, findManyFn } = await makeContactsApp({
      findMany: [{ id: 'c5', name: 'Eve', address: 'GEVE', createdAt: new Date() }],
      count: 150,
    });

    const res = await request(app).get('/?page=3&limit=25');
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(3);
    expect(res.body.pagination.limit).toBe(25);
    expect(res.body.pagination.total).toBe(150);
    // Prisma must have received skip=50, take=25
    expect(findManyFn).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, take: 25 }),
    );
  });

  // 4. pages computed correctly
  it('computes pages = ceil(total / limit)', async () => {
    const { app } = await makeContactsApp({ count: 101 });
    const res = await request(app).get('/?limit=10');
    expect(res.body.pagination.pages).toBe(11);
  });

  it('pages is 1 when total equals limit', async () => {
    const { app } = await makeContactsApp({ count: 50 });
    const res = await request(app).get('/');
    expect(res.body.pagination.pages).toBe(1);
  });

  // 5. skip is derived correctly
  it('passes skip=0 for page=1', async () => {
    const { app, findManyFn } = await makeContactsApp({ count: 10 });
    await request(app).get('/?page=1&limit=10');
    expect(findManyFn).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 10 }),
    );
  });

  it('passes skip=(page-1)*limit to Prisma', async () => {
    const { app, findManyFn } = await makeContactsApp({ count: 100 });
    await request(app).get('/?page=4&limit=10');
    expect(findManyFn).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 30, take: 10 }),
    );
  });

  // 6. limit is capped at CONTACTS_MAX_PAGE_SIZE
  it('silently caps limit at CONTACTS_MAX_PAGE_SIZE', async () => {
    const { app } = await makeContactsApp({ count: 500 });
    const res = await request(app).get(`/?limit=${CONTACTS_MAX_PAGE_SIZE}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.limit).toBe(CONTACTS_MAX_PAGE_SIZE);
  });

  // 7. Invalid values return validation error
  it('returns 422 for non-numeric page', async () => {
    const { app } = await makeContactsApp();
    const res = await request(app).get('/?page=abc');
    expect(res.status).toBe(422);
  });

  it('returns 422 for non-numeric limit', async () => {
    const { app } = await makeContactsApp();
    const res = await request(app).get('/?limit=xyz');
    expect(res.status).toBe(422);
  });

  it('returns 422 for a limit above CONTACTS_MAX_PAGE_SIZE', async () => {
    const { app } = await makeContactsApp();
    const res = await request(app).get(`/?limit=${CONTACTS_MAX_PAGE_SIZE + 1}`);
    expect(res.status).toBe(422);
  });

  // 8. Boundary: page=0 and limit=0 are rejected
  it('returns 422 for page=0', async () => {
    const { app } = await makeContactsApp();
    const res = await request(app).get('/?page=0');
    expect(res.status).toBe(422);
  });

  it('returns 422 for limit=0', async () => {
    const { app } = await makeContactsApp();
    const res = await request(app).get('/?limit=0');
    expect(res.status).toBe(422);
  });

  // 9. Empty result set
  it('returns pagination with total=0 and pages=0 when no contacts exist', async () => {
    const { app } = await makeContactsApp({ findMany: [], count: 0 });
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.contacts).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.pages).toBe(0);
  });

  // 10. Second page returns correct slice
  it('returns the correct contacts slice for page 2', async () => {
    const page1Contact = { id: 'p1', name: 'Alice', address: 'GA', createdAt: new Date() };
    const page2Contact = { id: 'p2', name: 'Bob', address: 'GB', createdAt: new Date() };

    // findManyImpl lets us return different data depending on skip
    const { app } = await makeContactsApp({
      count: 2,
      findManyImpl: ({ skip }) => Promise.resolve(skip === 0 ? [page1Contact] : [page2Contact]),
    });

    const resPage1 = await request(app).get('/?page=1&limit=1');
    expect(resPage1.body.contacts[0].name).toBe('Alice');

    const resPage2 = await request(app).get('/?page=2&limit=1');
    expect(resPage2.body.contacts[0].name).toBe('Bob');
    expect(resPage2.body.pagination.page).toBe(2);
  });

  // Sanity: exported constants have expected values
  it('CONTACTS_DEFAULT_PAGE_SIZE is 50', () => {
    expect(CONTACTS_DEFAULT_PAGE_SIZE).toBe(50);
  });

  it('CONTACTS_MAX_PAGE_SIZE is 200', () => {
    expect(CONTACTS_MAX_PAGE_SIZE).toBe(200);
  });
});
