/**
 * Auth Integration Tests (#477)
 * Tests all auth endpoints at the HTTP level using supertest.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import authRoutes from '../src/routes/auth.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../src/db/client.js');

vi.mock('../src/security/accountLockout.js', () => ({
  isAccountLocked: vi.fn().mockResolvedValue(false),
  recordFailedLogin: vi.fn().mockResolvedValue({}),
  clearFailedAttempts: vi.fn().mockResolvedValue({}),
  getLockoutDuration: vi.fn().mockReturnValue(30 * 60 * 1000),
  unlockAccount: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/recovery/recoveryStore.js', () => ({
  consumePendingCredentials: vi.fn().mockReturnValue(null),
}));

// Rate limiter: bypass in tests
vi.mock('../src/middleware/rateLimiter.js', () => ({
  createRateLimiter: () => (_req, _res, next) => next(),
  getClientIP: () => '127.0.0.1',
}));

// CSRF token endpoint stub
vi.mock('../src/middleware/csrf.js', () => ({
  csrfTokenEndpoint: (_req, res) => res.json({ csrfToken: 'test-csrf-token' }),
}));

// MFA / OAuth stubs (not under test here)
vi.mock('../src/security/mfa.js', () => ({
  default: {
    generateSecret: vi.fn(),
    enableMFA: vi.fn(),
    encryptSecret: vi.fn(),
    userMFA: new Map(),
    verifyTOTP: vi.fn(),
  },
}));

vi.mock('../src/security/oauth2.js', () => ({
  default: { getGoogleAuthURL: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import prisma from '../src/db/client.js';
import {
  isAccountLocked,
  recordFailedLogin,
  clearFailedAttempts,
} from '../src/security/accountLockout.js';

process.env.JWT_SECRET = 'test-secret-integration';
process.env.NODE_ENV = 'test';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  return app;
}

const VALID_USER = { username: 'integuser', password: 'Password1!' };

// A pre-hashed password for VALID_USER.password (generated once via hashPassword)
// We'll use the real hashPassword to keep tests honest.
import { hashPassword } from '../src/auth/password.js';

async function mockExistingUser(overrides = {}) {
  const hash = await hashPassword(VALID_USER.password);
  const user = {
    id: 'user-uuid-1',
    username: VALID_USER.username,
    passwordHash: hash,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  vi.mocked(prisma.user.findUnique).mockResolvedValue(user);
  return user;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  let app;
  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    vi.mocked(isAccountLocked).mockResolvedValue(false);
  });

  it('registers a new user successfully', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'user-uuid-1',
      username: VALID_USER.username,
    });

    const res = await request(app)
      .post('/api/auth/register')
      .send(VALID_USER);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: VALID_USER.username });
  });

  it('rejects duplicate username with 409', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'x', username: VALID_USER.username });

    const res = await request(app)
      .post('/api/auth/register')
      .send(VALID_USER);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('rejects username shorter than 3 chars with 422', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ab', password: 'Password1!' });

    expect(res.status).toBe(422);
    expect(res.body.errors).toBeDefined();
  });

  it('rejects password shorter than 8 chars with 422', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'validuser', password: 'short' });

    expect(res.status).toBe(422);
    expect(res.body.errors).toBeDefined();
  });
});

describe('POST /api/auth/login', () => {
  let app;
  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    vi.mocked(isAccountLocked).mockResolvedValue(false);
  });

  it('logs in with correct credentials and returns accessToken + sets cookie', async () => {
    await mockExistingUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send(VALID_USER);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.headers['set-cookie']).toBeDefined();
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken/);
    expect(clearFailedAttempts).toHaveBeenCalledWith(VALID_USER.username);
  });

  it('rejects wrong password with 401', async () => {
    await mockExistingUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: VALID_USER.username, password: 'WrongPass1!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
    expect(recordFailedLogin).toHaveBeenCalled();
  });

  it('rejects unknown user with 401', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'Password1!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  it('returns 423 when account is locked', async () => {
    vi.mocked(isAccountLocked).mockResolvedValue(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send(VALID_USER);

    expect(res.status).toBe(423);
    expect(res.body.error).toMatch(/locked/i);
  });
});

describe('POST /api/auth/refresh', () => {
  let app;
  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('issues a new accessToken when a valid refreshToken cookie is present', async () => {
    // First login to get a real refresh token cookie
    vi.mocked(isAccountLocked).mockResolvedValue(false);
    await mockExistingUser();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send(VALID_USER);

    const cookies = loginRes.headers['set-cookie'];
    expect(cookies).toBeDefined();

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeDefined();
  });

  it('returns 401 when no refresh token cookie is present', async () => {
    const res = await request(app).post('/api/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing|expired/i);
  });

  it('returns 401 for a tampered refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'refreshToken=invalid.token.here');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  let app;
  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    vi.mocked(isAccountLocked).mockResolvedValue(false);
  });

  it('logs out an authenticated user', async () => {
    await mockExistingUser();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send(VALID_USER);

    const { accessToken } = loginRes.body;

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/profile', () => {
  let app;
  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    vi.mocked(isAccountLocked).mockResolvedValue(false);
  });

  it('returns profile for authenticated user', async () => {
    const user = await mockExistingUser();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send(VALID_USER);

    const { accessToken } = loginRes.body;

    // getUserById is called by profile route
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user);

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe(VALID_USER.username);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
  });
});
