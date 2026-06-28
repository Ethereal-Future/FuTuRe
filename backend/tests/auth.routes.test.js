/**
 * Integration tests for /auth routes
 * Covers registration, login, token refresh, and logout flows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

vi.mock('../src/db/client.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    session: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

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

vi.mock('../src/middleware/rateLimiter.js', () => ({
  createRateLimiter: () => (_req, _res, next) => next(),
  getClientIP: () => '127.0.0.1',
}));

vi.mock('../src/middleware/csrf.js', () => ({
  csrfTokenEndpoint: (_req, res) => res.json({ csrfToken: 'test-token' }),
}));

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

vi.mock('../src/notifications/channels/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({}),
}));

process.env.JWT_SECRET = 'test-secret-auth-routes';
process.env.NODE_ENV = 'test';

import { hashPassword } from '../src/auth/password.js';
import authRoutes from '../src/routes/auth.js';
import prisma from '../src/db/client.js';
import { isAccountLocked } from '../src/security/accountLockout.js';

const VALID_CREDS = { username: 'testuser', password: 'Password1!' };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  return app;
}

async function buildMockUser(overrides = {}) {
  const hash = await hashPassword(VALID_CREDS.password);
  return {
    id: 'user-test-1',
    username: VALID_CREDS.username,
    passwordHash: hash,
    role: 'USER',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockSessionCreate() {
  vi.mocked(prisma.session.create).mockResolvedValue({
    id: 'sess-1',
    userId: 'user-test-1',
    device: 'Web browser',
    ipAddress: '127.0.0.1',
    lastActiveAt: new Date(),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
}

function mockActiveSession() {
  vi.mocked(prisma.session.findFirst).mockResolvedValue({
    id: 'sess-1',
    userId: 'user-test-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  vi.mocked(prisma.session.update).mockResolvedValue({});
}

describe('POST /api/auth/register', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    vi.mocked(isAccountLocked).mockResolvedValue(false);
  });

  it('creates a user and returns 201 with user data', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({
      id: 'user-new-1',
      username: 'newuser',
      createdAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', password: 'Password1!' });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.username).toBe('newuser');
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('returns 409 when username is already taken', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'existing',
      username: 'taken',
    });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'taken', password: 'Password1!' });

    expect(res.status).toBe(409);
  });

  it('returns 422 when username is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ password: 'Password1!' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser' });

    expect(res.status).toBe(422);
  });

  it('returns 422 when password is below minimum length', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'newuser', password: 'short' });

    expect(res.status).toBe(422);
    const errors = res.body.error.details;
    expect(errors.some((e) => /password/i.test(e.msg))).toBe(true);
  });

  it('returns 422 when username is too short', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'ab', password: 'Password1!' });

    expect(res.status).toBe(422);
  });
});

describe('POST /api/auth/login', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    vi.mocked(isAccountLocked).mockResolvedValue(false);
    mockSessionCreate();
    mockActiveSession();
  });

  it('returns 200 with access token and sets HttpOnly refresh cookie on success', async () => {
    const user = await buildMockUser();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user);

    const res = await request(app)
      .post('/api/auth/login')
      .send(VALID_CREDS);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const refreshCookie = setCookie.find((c) => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
  });

  it('returns 401 for incorrect password without revealing whether account exists', async () => {
    const user = await buildMockUser();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: VALID_CREDS.username, password: 'WrongPass1!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('returns 401 when the user does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'Password1!' });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('returns 423 when the account is locked', async () => {
    vi.mocked(isAccountLocked).mockResolvedValue(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send(VALID_CREDS);

    expect(res.status).toBe(423);
    expect(res.body.error.details.retryAfter).toBeDefined();
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('POST /api/auth/refresh', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    vi.mocked(isAccountLocked).mockResolvedValue(false);
    mockSessionCreate();
    mockActiveSession();
  });

  async function loginAndGetCookie() {
    const user = await buildMockUser();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send(VALID_CREDS);

    const setCookie = loginRes.headers['set-cookie'];
    return setCookie.find((c) => c.startsWith('refreshToken='));
  }

  it('returns a new access token given a valid refresh token cookie', async () => {
    const cookieHeader = await loginAndGetCookie();

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('returns 401 when the refresh token cookie is absent', async () => {
    const res = await request(app).post('/api/auth/refresh');

    expect(res.status).toBe(401);
  });

  it('returns 401 when the session has been revoked', async () => {
    const cookieHeader = await loginAndGetCookie();

    vi.mocked(prisma.session.findFirst).mockResolvedValue(null);

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader);

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    vi.mocked(isAccountLocked).mockResolvedValue(false);
    mockSessionCreate();
    mockActiveSession();
  });

  async function loginAndGetTokens() {
    const user = await buildMockUser();
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send(VALID_CREDS);

    const cookieHeader = loginRes.headers['set-cookie'].find((c) =>
      c.startsWith('refreshToken='),
    );
    return { accessToken: loginRes.body.accessToken, cookieHeader };
  }

  it('returns 200 and clears the refresh token cookie on logout', async () => {
    vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 1 });
    const { accessToken } = await loginAndGetTokens();

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);

    const setCookie = res.headers['set-cookie'] ?? [];
    const cleared = setCookie.find((c) => c.startsWith('refreshToken='));
    if (cleared) {
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    }
  });

  it('returns 401 without a valid access token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });

  it('refresh fails after logout because the session is revoked', async () => {
    vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 1 });
    const { accessToken, cookieHeader } = await loginAndGetTokens();

    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);

    vi.mocked(prisma.session.findFirst).mockResolvedValue(null);

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader);

    expect(refreshRes.status).toBe(401);
  });
});
