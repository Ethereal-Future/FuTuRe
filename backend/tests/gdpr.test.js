/**
 * GDPR endpoint tests — issue #503
 * GET  /api/auth/data-export
 * DELETE /api/auth/account
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import authRoutes from '../src/routes/auth.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../src/db/client.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    kYCRecord: {
      updateMany: vi.fn(),
    },
    transaction: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
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
  default: { generateSecret: vi.fn(), enableMFA: vi.fn(), userMFA: new Map(), verifyTOTP: vi.fn() },
}));

vi.mock('../src/security/oauth2.js', () => ({
  default: { getGoogleAuthURL: vi.fn() },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

import prisma from '../src/db/client.js';
import { signAccessToken } from '../src/auth/tokens.js';

process.env.JWT_SECRET = 'test-secret-gdpr';
process.env.NODE_ENV = 'test';

const USER_ID = 'gdpr-user-uuid-1';
const ACCESS_TOKEN = signAccessToken({ sub: USER_ID, username: 'testuser' });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  return app;
}

const MOCK_USER = {
  id: USER_ID,
  username: 'testuser',
  publicKey: 'GABC123',
  passwordHash: 'hashed',
  createdAt: new Date().toISOString(),
  settings: null,
  kycRecord: null,
  sentTxs: [],
  receivedTxs: [],
  notifications: [],
};

// ── GET /api/auth/data-export ─────────────────────────────────────────────────

describe('GET /api/auth/data-export', () => {
  let app;
  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns 200 with user data, omitting passwordHash', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER);

    const res = await request(app)
      .get('/api/auth/data-export')
      .set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(res.body.data.username).toBe('testuser');
    expect(res.body.exportedAt).toBeDefined();
  });

  it('sets Content-Disposition attachment header', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MOCK_USER);

    const res = await request(app)
      .get('/api/auth/data-export')
      .set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('data-export.json');
  });

  it('returns 404 when user does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await request(app)
      .get('/api/auth/data-export')
      .set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/data-export');
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/auth/account ──────────────────────────────────────────────────

describe('DELETE /api/auth/account', () => {
  let app;
  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();

    // Default: $transaction executes the callback
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => fn(prisma));
    vi.mocked(prisma.user.update).mockResolvedValue({ id: USER_ID, deletedAt: new Date() });
    vi.mocked(prisma.kYCRecord.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.transaction.updateMany).mockResolvedValue({ count: 0 });
  });

  it('returns 200 with scheduledPermanentDeletion 30 days out', async () => {
    const before = Date.now();

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.scheduledPermanentDeletion).toBeDefined();

    const deletionDate = new Date(res.body.scheduledPermanentDeletion).getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(deletionDate).toBeGreaterThanOrEqual(before + thirtyDays - 1000);
    expect(deletionDate).toBeLessThanOrEqual(before + thirtyDays + 5000);
  });

  it('anonymises the user record', async () => {
    await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(vi.mocked(prisma.user.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({
          publicKey: expect.stringMatching(/^ANONYMIZED-/),
          username: expect.stringMatching(/^deleted-/),
          passwordHash: '',
        }),
      })
    );
  });

  it('anonymises the KYC record', async () => {
    await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(vi.mocked(prisma.kYCRecord.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER_ID },
        data: expect.objectContaining({ fullName: '[REDACTED]' }),
      })
    );
  });

  it('clears transaction memos', async () => {
    await request(app).delete('/api/auth/account').set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(vi.mocked(prisma.transaction.updateMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ senderId: USER_ID }, { recipientId: USER_ID }] },
        data: { memo: null },
      })
    );
  });

  it('returns 404 when user does not exist', async () => {
    const p2025 = new Error('Record not found');
    p2025.code = 'P2025';
    vi.mocked(prisma.$transaction).mockRejectedValue(p2025);

    const res = await request(app)
      .delete('/api/auth/account')
      .set('Authorization', `Bearer ${ACCESS_TOKEN}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/auth/account');
    expect(res.status).toBe(401);
  });
});
