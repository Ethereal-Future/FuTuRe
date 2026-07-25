/**
 * Session management tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { hashPassword } from '../src/auth/password.js';

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

import authRoutes from '../src/routes/auth.js';
import prisma from '../src/db/client.js';

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
  getClientIP: () => '192.168.1.10',
}));

vi.mock('../src/middleware/csrf.js', () => ({
  csrfTokenEndpoint: (_req, res) => res.json({ csrfToken: 'test-csrf-token' }),
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

process.env.JWT_SECRET = 'test-secret-sessions';
process.env.NODE_ENV = 'test';

const VALID_USER = { username: 'sessionuser', password: 'Password1!' };
const SESSION_ID = 'session-uuid-1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  return app;
}

async function mockExistingUser() {
  const hash = await hashPassword(VALID_USER.password);
  const user = {
    id: 'user-uuid-1',
    username: VALID_USER.username,
    passwordHash: hash,
    role: 'USER',
    createdAt: new Date().toISOString(),
  };
  vi.mocked(prisma.user.findUnique).mockResolvedValue(user);
  return user;
}

function mockSessionCreate() {
  vi.mocked(prisma.session.create).mockResolvedValue({
    id: SESSION_ID,
    userId: 'user-uuid-1',
    device: 'Linux',
    ipAddress: '192.168.1.10',
    lastActiveAt: new Date(),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
}

function mockActiveSession() {
  vi.mocked(prisma.session.findFirst).mockResolvedValue({
    id: SESSION_ID,
    userId: 'user-uuid-1',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  vi.mocked(prisma.session.update).mockResolvedValue({});
}

describe('Session management', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    mockSessionCreate();
    mockActiveSession();
  });

  async function login() {
    await mockExistingUser();
    return request(app)
      .post('/api/auth/login')
      .set('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64)')
      .send(VALID_USER);
  }

  describe('GET /api/auth/sessions', () => {
    it('lists active sessions for authenticated user', async () => {
      const loginRes = await login();
      const { accessToken } = loginRes.body;

      vi.mocked(prisma.session.findMany).mockResolvedValue([
        {
          id: SESSION_ID,
          device: 'Linux',
          ipAddress: '192.168.1.10',
          lastActiveAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: 'session-uuid-2',
          device: 'iPhone / iPad',
          ipAddress: '10.0.0.5',
          lastActiveAt: new Date(),
          createdAt: new Date(),
        },
      ]);

      const res = await request(app)
        .get('/api/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(2);
      expect(res.body.sessions[0].current).toBe(true);
      expect(res.body.sessions[1].current).toBe(false);
    });

    it('returns 401 without token', async () => {
      const res = await request(app).get('/api/auth/sessions');
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/auth/sessions/:id', () => {
    it('revokes a specific session', async () => {
      const loginRes = await login();
      const { accessToken } = loginRes.body;

      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 1 });

      const res = await request(app)
        .delete('/api/auth/sessions/session-uuid-2')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/revoked/i);
    });

    it('returns 404 for unknown session', async () => {
      const loginRes = await login();
      const { accessToken } = loginRes.body;

      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 0 });

      const res = await request(app)
        .delete('/api/auth/sessions/unknown-id')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/auth/sessions', () => {
    it('revokes all other sessions', async () => {
      const loginRes = await login();
      const { accessToken } = loginRes.body;

      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 2 });

      const res = await request(app)
        .delete('/api/auth/sessions')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.revokedCount).toBe(2);
    });
  });

  describe('POST /api/auth/login', () => {
    it('creates a session with device and IP metadata', async () => {
      await login();

      expect(prisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-uuid-1',
            device: 'Linux',
            ipAddress: '192.168.1.10',
          }),
        }),
      );
    });
  });
});
