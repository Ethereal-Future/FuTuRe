/**
 * Role-Based Access Control — Compliance API
 *
 * Tests that:
 *  - requireRole middleware allows/denies based on JWT role claim
 *  - Compliance-only endpoints reject USER role (403)
 *  - Compliance-only endpoints accept COMPLIANCE and ADMIN roles
 *  - Unauthenticated requests get 401
 *  - Role assignment endpoint is restricted to ADMIN
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { requireRole, requireAdmin } from '../src/middleware/adminAuth.js';

// ── Helper: build mock Express req/res/next ───────────────────────────────────

function makeReq(token) {
  return {
    headers: { authorization: token ? `Bearer ${token}` : undefined },
  };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// ── Token factory ─────────────────────────────────────────────────────────────

function tokenFor(role) {
  return signAccessToken({ sub: 'user-1', username: 'tester', role });
}

// ── requireRole middleware unit tests ─────────────────────────────────────────

describe('requireRole middleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  it('returns 401 when no Authorization header is present', () => {
    const middleware = requireRole('COMPLIANCE', 'ADMIN');
    const req = makeReq(null);
    const res = makeRes();
    let called = false;
    middleware(req, res, () => { called = true; });
    expect(res._status).toBe(401);
    expect(called).toBe(false);
  });

  it('returns 401 when the token is invalid', () => {
    const middleware = requireRole('COMPLIANCE', 'ADMIN');
    const req = makeReq('not-a-valid-jwt');
    const res = makeRes();
    let called = false;
    middleware(req, res, () => { called = true; });
    expect(res._status).toBe(401);
    expect(called).toBe(false);
  });

  it('returns 403 when user role is USER (not in allowed list)', () => {
    const middleware = requireRole('COMPLIANCE', 'ADMIN');
    const req = makeReq(tokenFor('USER'));
    const res = makeRes();
    let called = false;
    middleware(req, res, () => { called = true; });
    expect(res._status).toBe(403);
    expect(res._body.error).toMatch(/Insufficient permissions/i);
    expect(called).toBe(false);
  });

  it('allows access for COMPLIANCE role', () => {
    const middleware = requireRole('COMPLIANCE', 'ADMIN');
    const req = makeReq(tokenFor('COMPLIANCE'));
    const res = makeRes();
    let called = false;
    middleware(req, res, () => { called = true; });
    expect(called).toBe(true);
    expect(req.user.role).toBe('COMPLIANCE');
  });

  it('allows access for ADMIN role', () => {
    const middleware = requireRole('COMPLIANCE', 'ADMIN');
    const req = makeReq(tokenFor('ADMIN'));
    const res = makeRes();
    let called = false;
    middleware(req, res, () => { called = true; });
    expect(called).toBe(true);
    expect(req.user.role).toBe('ADMIN');
  });

  it('denies access when role is absent from token', () => {
    const middleware = requireRole('COMPLIANCE', 'ADMIN');
    const token = signAccessToken({ sub: 'user-2', username: 'norole' }); // no role field
    const req = makeReq(token);
    const res = makeRes();
    let called = false;
    middleware(req, res, () => { called = true; });
    expect(res._status).toBe(403);
    expect(called).toBe(false);
  });
});

// ── requireAdmin middleware unit tests ────────────────────────────────────────

describe('requireAdmin middleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  it('returns 403 when role is COMPLIANCE (not ADMIN)', () => {
    const req = makeReq(tokenFor('COMPLIANCE'));
    const res = makeRes();
    let called = false;
    requireAdmin(req, res, () => { called = true; });
    expect(res._status).toBe(403);
    expect(called).toBe(false);
  });

  it('returns 403 when role is USER', () => {
    const req = makeReq(tokenFor('USER'));
    const res = makeRes();
    let called = false;
    requireAdmin(req, res, () => { called = true; });
    expect(res._status).toBe(403);
    expect(called).toBe(false);
  });

  it('allows access for ADMIN role', () => {
    const req = makeReq(tokenFor('ADMIN'));
    const res = makeRes();
    let called = false;
    requireAdmin(req, res, () => { called = true; });
    expect(called).toBe(true);
  });
});

// ── Role claim in access token ────────────────────────────────────────────────

describe('JWT role claim', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  it('preserves USER role in token payload', async () => {
    const { verifyToken } = await import('../src/auth/tokens.js');
    const token = tokenFor('USER');
    const payload = verifyToken(token);
    expect(payload.role).toBe('USER');
  });

  it('preserves COMPLIANCE role in token payload', async () => {
    const { verifyToken } = await import('../src/auth/tokens.js');
    const token = tokenFor('COMPLIANCE');
    const payload = verifyToken(token);
    expect(payload.role).toBe('COMPLIANCE');
  });

  it('preserves ADMIN role in token payload', async () => {
    const { verifyToken } = await import('../src/auth/tokens.js');
    const token = tokenFor('ADMIN');
    const payload = verifyToken(token);
    expect(payload.role).toBe('ADMIN');
  });
});
