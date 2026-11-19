/**
 * Unified device-bound sessions and coordinated global logout (#1381).
 *
 * Prisma is replaced with a small in-memory `Session` table that honours the
 * where-clauses sessionStore.js uses, plus a `$transaction` that records each
 * call so the test can assert global revocation happens in one transaction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const table = vi.hoisted(() => new Map());

function matches(row, where = {}) {
  for (const [field, cond] of Object.entries(where)) {
    const value = row[field];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond && value === cond.not) return false;
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('gt' in cond && !(value > cond.gt)) return false;
    } else if (cond === null) {
      if (value !== null && value !== undefined) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}

function pick(row, select) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
}

const prismaMock = vi.hoisted(() => ({}));

vi.mock('../db/client.js', () => {
  const session = {
    create: vi.fn(async ({ data }) => {
      const now = new Date();
      const row = { id: crypto.randomUUID(), createdAt: now, lastActiveAt: now, revokedAt: null, ...data };
      table.set(row.id, row);
      return { ...row };
    }),
    findFirst: vi.fn(async ({ where }) => {
      const row = [...table.values()].find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    findMany: vi.fn(async ({ where, select }) =>
      [...table.values()].filter((r) => matches(r, where)).map((r) => pick(r, select)),
    ),
    update: vi.fn(async ({ where, data }) => {
      const row = table.get(where.id);
      Object.assign(row, data);
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      const rows = [...table.values()].filter((r) => matches(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    }),
  };
  Object.assign(prismaMock, {
    session,
    $transaction: vi.fn(async (fn) => fn({ session })),
  });
  return { default: prismaMock };
});

delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;

const { default: mobileSessions } = await import('./sessions.js');
const { createSession, getActiveSession, getActiveSessionForDevice, revokeAllSessions } = await import(
  '../auth/sessionStore.js'
);

describe('mobile sessions — device binding (#1381)', () => {
  beforeEach(() => {
    table.clear();
    vi.clearAllMocks();
  });

  it('persists mobile sessions in the shared Prisma Session table with device metadata', async () => {
    const sessionId = await mobileSessions.create('user-1', 'device-A', {
      deviceModel: 'Pixel 8',
      osVersion: 'Android 15',
      appVersion: '3.2.0',
    });

    expect(prismaMock.session.create).toHaveBeenCalledTimes(1);
    expect(table.get(sessionId)).toMatchObject({
      userId: 'user-1',
      deviceId: 'device-A',
      deviceModel: 'Pixel 8',
      osVersion: 'Android 15',
      appVersion: '3.2.0',
      revokedAt: null,
    });
  });

  it('requires a deviceId to create a mobile session', async () => {
    await expect(mobileSessions.create('user-1', undefined)).rejects.toThrow(/deviceId is required/);
  });

  it('accepts the session when X-Device-Id matches the bound device', async () => {
    const sessionId = await mobileSessions.create('user-1', 'device-A');
    const session = await mobileSessions.validate(sessionId, 'device-A');
    expect(session).toMatchObject({ sessionId, userId: 'user-1', deviceId: 'device-A' });
  });

  it('rejects the session on deviceId mismatch', async () => {
    const sessionId = await mobileSessions.create('user-1', 'device-A');
    await expect(mobileSessions.validate(sessionId, 'device-B')).rejects.toMatchObject({
      code: 'SESSION_DEVICE_MISMATCH',
      status: 401,
    });
    await expect(getActiveSessionForDevice(sessionId, 'device-B')).rejects.toMatchObject({
      code: 'SESSION_DEVICE_MISMATCH',
    });
  });

  it('rejects the session when no X-Device-Id is presented', async () => {
    const sessionId = await mobileSessions.create('user-1', 'device-A');
    await expect(mobileSessions.validate(sessionId, undefined)).rejects.toMatchObject({
      code: 'SESSION_DEVICE_MISMATCH',
    });
  });

  it('does not accept a web (device-less) session on mobile routes', async () => {
    const web = await createSession('user-1', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
    await expect(mobileSessions.validate(web.id, 'device-A')).rejects.toMatchObject({
      code: 'SESSION_DEVICE_MISMATCH',
    });
  });

  it('returns null for an expired session', async () => {
    const sessionId = await mobileSessions.create('user-1', 'device-A', { ttlMs: -1000 });
    expect(await mobileSessions.validate(sessionId, 'device-A')).toBeNull();
  });

  it('only lets a user revoke their own sessions', async () => {
    const sessionId = await mobileSessions.create('user-1', 'device-A');
    expect(await mobileSessions.revoke(sessionId, 'attacker')).toBe(false);
    expect(await mobileSessions.validate(sessionId, 'device-A')).not.toBeNull();

    expect(await mobileSessions.revoke(sessionId, 'user-1')).toBe(true);
    expect(await mobileSessions.validate(sessionId, 'device-A')).toBeNull();
  });

  it('lists only device-bound sessions for the mobile session view', async () => {
    await createSession('user-1', { userAgent: 'Mozilla/5.0 (Macintosh)' });
    const mobileId = await mobileSessions.create('user-1', 'device-A');
    const listed = await mobileSessions.listForUser('user-1');
    expect(listed.map((s) => s.sessionId)).toEqual([mobileId]);
  });
});

describe('revokeAllSessions — coordinated global logout (#1381)', () => {
  beforeEach(() => {
    table.clear();
    vi.clearAllMocks();
  });

  it('clears both web and mobile sessions in a single transaction', async () => {
    const web = await createSession('user-1', { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' });
    const ios = await mobileSessions.create('user-1', 'device-ios');
    const android = await mobileSessions.create('user-1', 'device-android');
    const otherUser = await mobileSessions.create('user-2', 'device-other');

    const revoked = await revokeAllSessions('user-1');

    expect(revoked).toBe(3);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(table.get(web.id).revokedAt).toBeInstanceOf(Date);
    expect(table.get(ios).revokedAt).toBeInstanceOf(Date);
    expect(table.get(android).revokedAt).toBeInstanceOf(Date);

    expect(await getActiveSession(web.id)).toBeNull();
    expect(await mobileSessions.validate(ios, 'device-ios')).toBeNull();
    expect(await mobileSessions.validate(android, 'device-android')).toBeNull();

    // Unrelated users are untouched.
    expect(table.get(otherUser).revokedAt).toBeNull();
  });

  it('a logout-everywhere from mobile also kills web sessions', async () => {
    const web = await createSession('user-1', { userAgent: 'Mozilla/5.0' });
    await mobileSessions.create('user-1', 'device-A');

    await mobileSessions.revokeAll('user-1');

    expect(await getActiveSession(web.id)).toBeNull();
    expect(await mobileSessions.listForUser('user-1')).toEqual([]);
  });

  it('keeps the excepted session when logging out other devices', async () => {
    const current = await createSession('user-1', { userAgent: 'Mozilla/5.0' });
    const phone = await mobileSessions.create('user-1', 'device-A');

    expect(await revokeAllSessions('user-1', current.id)).toBe(1);
    expect(await getActiveSession(current.id)).not.toBeNull();
    expect(await mobileSessions.validate(phone, 'device-A')).toBeNull();
  });
});
