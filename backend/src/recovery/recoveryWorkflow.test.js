// @vitest-environment node
/**
 * Account recovery workflow: durable Prisma persistence (#1387),
 * cryptographic guardian approvals (#1388), and on-chain key rotation with
 * session teardown on completion (#1389).
 *
 * Prisma is replaced with small in-memory tables that honour the queries
 * recoveryWorkflow.js issues. Those tables are hoisted outside the module
 * graph, so re-importing the workflow after vi.resetModules() behaves like a
 * second API node sharing the same database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import express from 'express';
import request from 'supertest';
import { Keypair } from '@stellar/stellar-sdk';

const db = vi.hoisted(() => ({
  requests: new Map(),
  approvals: new Map(),
  users: new Map(),
  refreshTokens: [],
}));
const contactsByUser = vi.hoisted(() => new Map());
const sentEmails = vi.hoisted(() => []);
const rotateRecoveredAccountSigner = vi.hoisted(() => vi.fn());
const revokeAllSessions = vi.hoisted(() => vi.fn());
const revokeUserTokens = vi.hoisted(() => vi.fn());
const sendNotification = vi.hoisted(() => vi.fn());

function matches(row, where = {}) {
  return Object.entries(where).every(([field, cond]) => {
    const value = row[field];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('not' in cond && value === cond.not) return false;
      if ('lt' in cond && !(value < cond.lt)) return false;
      return true;
    }
    if (cond === null) return value === null || value === undefined;
    return value === cond;
  });
}

function withApprovals(row) {
  return {
    ...row,
    approvals: [...db.approvals.values()].filter((a) => a.requestId === row.id).map((a) => ({ ...a })),
  };
}

const ACTIVE = ['pending', 'approved', 'completing'];

vi.mock('../db/client.js', () => {
  const recoveryRequest = {
    create: vi.fn(async ({ data }) => {
      const { approvals, ...fields } = data;
      // Mirrors the partial unique index RecoveryRequest_one_active_per_user.
      if ([...db.requests.values()].some((r) => r.userId === fields.userId && ACTIVE.includes(r.status))) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row = {
        id: crypto.randomUUID(),
        attempts: 0,
        status: 'pending',
        newPublicKey: null,
        oldPublicKey: null,
        rotationTxHash: null,
        completedAt: null,
        cancelledAt: null,
        ...fields,
      };
      db.requests.set(row.id, row);
      for (const a of approvals?.create ?? []) {
        const approval = { id: crypto.randomUUID(), requestId: row.id, approvedAt: null, ...a };
        db.approvals.set(approval.id, approval);
      }
      return withApprovals(row);
    }),
    findUnique: vi.fn(async ({ where }) => {
      const row = db.requests.get(where.id);
      return row ? withApprovals(row) : null;
    }),
    findFirst: vi.fn(async ({ where }) => {
      const row = [...db.requests.values()].find((r) => matches(r, where));
      return row ? withApprovals(row) : null;
    }),
    findMany: vi.fn(async ({ where }) =>
      [...db.requests.values()].filter((r) => matches(r, where)).map(withApprovals),
    ),
    update: vi.fn(async ({ where, data }) => {
      const row = db.requests.get(where.id);
      Object.assign(row, data);
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }) => {
      const rows = [...db.requests.values()].filter((r) => matches(r, where));
      rows.forEach((r) => Object.assign(r, data));
      return { count: rows.length };
    }),
  };
  const recoveryApproval = {
    updateMany: vi.fn(async ({ where, data }) => {
      const rows = [...db.approvals.values()].filter((a) => matches(a, where));
      rows.forEach((a) => Object.assign(a, data));
      return { count: rows.length };
    }),
  };
  const user = {
    findUnique: vi.fn(async ({ where }) => {
      const row = db.users.get(where.id);
      return row ? { ...row } : null;
    }),
    update: vi.fn(async ({ where, data }) => {
      const row = db.users.get(where.id);
      Object.assign(row, data);
      return { ...row };
    }),
  };
  const refreshToken = {
    updateMany: vi.fn(async ({ where, data }) => {
      const rows = db.refreshTokens.filter((t) => matches(t, where));
      rows.forEach((t) => Object.assign(t, data));
      return { count: rows.length };
    }),
  };
  return {
    default: {
      recoveryRequest,
      recoveryApproval,
      user,
      refreshToken,
      $transaction: vi.fn(async (ops) => Promise.all(ops)),
    },
  };
});

vi.mock('./contactManager.js', () => ({
  getContacts: (userId) => contactsByUser.get(userId) || [],
  getConfirmedContactCount: (userId) => (contactsByUser.get(userId) || []).filter((c) => c.confirmedAt).length,
  addContact: vi.fn(),
  confirmContact: vi.fn(),
  removeContact: vi.fn(),
}));

vi.mock('../notifications/channels/email.js', () => ({
  sendEmail: vi.fn(async (to, content) => {
    sentEmails.push({ to, ...content });
    return { success: true };
  }),
}));

vi.mock('../notifications/service.js', () => ({ sendNotification }));
vi.mock('../services/keypairRotation.js', () => ({ rotateRecoveredAccountSigner }));
vi.mock('../auth/sessionStore.js', () => ({ revokeAllSessions }));
vi.mock('../auth/refreshTokenStore.js', () => ({ revokeUserTokens }));
vi.mock('../security/auditLogger.js', () => ({ default: { logEvent: vi.fn(async () => ({})) } }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.user = { sub: 'user-1' };
    next();
  },
}));
vi.mock('../auth/userStore.js', () => ({
  getUserById: async (id) => db.users.get(id) || null,
}));

const prisma = (await import('../db/client.js')).default;
const workflow = await import('./recoveryWorkflow.js');
const { initiateRecovery, recordAttempt, addApproval, completeRecovery, cancelRecovery, getActiveRequest, getRequest, RecoveryAuthError } = workflow;

const USER_ID = 'user-1';
const OLD_KEY = Keypair.random().publicKey();
const NEW_KEY = Keypair.random().publicKey();

function addGuardians(userId, n) {
  const contacts = Array.from({ length: n }, (_, i) => ({
    id: crypto.randomUUID(),
    email: `guardian${i}@example.com`,
    name: `Guardian ${i}`,
    confirmedAt: new Date().toISOString(),
  }));
  contactsByUser.set(userId, contacts);
  return contacts;
}

function tokenFor(contact) {
  const email = sentEmails.find((e) => e.to === contact.email);
  return email.body.match(/Approval token: ([0-9a-f]{64})/)[1];
}

function elapseTimeLock(requestId) {
  db.requests.get(requestId).executeAfter = new Date(Date.now() - 1000);
}

beforeEach(() => {
  db.requests.clear();
  db.approvals.clear();
  db.users.clear();
  db.refreshTokens.length = 0;
  contactsByUser.clear();
  sentEmails.length = 0;
  vi.clearAllMocks();
  db.users.set(USER_ID, { id: USER_ID, publicKey: OLD_KEY });
  rotateRecoveredAccountSigner.mockResolvedValue({ hash: 'a'.repeat(64), ledger: 123, newSignerWeight: 1 });
  revokeAllSessions.mockResolvedValue(2);
  sendNotification.mockResolvedValue({});
});

// ── #1387 Durable persistence ─────────────────────────────────────────────────

describe('recovery persistence (#1387)', () => {
  it('keeps no module-level in-memory request maps', () => {
    const source = fs.readFileSync(new URL('./recoveryWorkflow.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/new Map\(\)/);
    expect(source).not.toMatch(/recoveryRequests|userRequests/);
  });

  it('writes the request to prisma.recoveryRequest with a 24h time-lock and 72h expiry', async () => {
    const before = Date.now();
    const req = await initiateRecovery(USER_ID, 'phrase', '10.0.0.1');

    expect(prisma.recoveryRequest.create).toHaveBeenCalledTimes(1);
    const row = db.requests.get(req.id);
    expect(row).toMatchObject({ userId: USER_ID, method: 'phrase', status: 'pending', ipAddress: '10.0.0.1' });
    expect(row.executeAfter.getTime() - before).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 50);
    expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(72 * 3600 * 1000 - 50);
  });

  it('serves requests created on one node to another node sharing the database', async () => {
    const created = await initiateRecovery(USER_ID, 'phrase', '10.0.0.1');

    vi.resetModules();
    const nodeB = await import('./recoveryWorkflow.js');
    expect(nodeB).not.toBe(workflow);

    const seenByB = await nodeB.getRequest(created.id);
    expect(seenByB).toMatchObject({ id: created.id, userId: USER_ID, status: 'pending' });

    await nodeB.recordAttempt(created.id, true);
    expect((await getActiveRequest(USER_ID)).status).toBe('approved');
  });

  it('rejects a second active request, including a race lost at the unique index', async () => {
    await initiateRecovery(USER_ID, 'phrase', '10.0.0.1');
    await expect(initiateRecovery(USER_ID, 'phrase', '10.0.0.1')).rejects.toThrow('Recovery already in progress');

    db.requests.clear();
    prisma.recoveryRequest.findFirst.mockResolvedValueOnce(null);
    prisma.recoveryRequest.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(initiateRecovery(USER_ID, 'phrase', '10.0.0.1')).rejects.toThrow('Recovery already in progress');
  });

  it('persists attempt counts and locks after 5 failures', async () => {
    const { id } = await initiateRecovery(USER_ID, 'phrase', '10.0.0.1');
    for (let i = 0; i < 4; i++) await recordAttempt(id, false);
    expect(db.requests.get(id).attempts).toBe(4);

    await expect(recordAttempt(id, false)).rejects.toThrow('Recovery locked');
    expect(db.requests.get(id)).toMatchObject({ attempts: 5, status: 'locked' });
  });

  it('refuses an attempt whose counter changed underneath it', async () => {
    const { id } = await initiateRecovery(USER_ID, 'phrase', '10.0.0.1');
    prisma.recoveryRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(recordAttempt(id, false)).rejects.toThrow('modified concurrently');
  });

  it('persists expiry when an attempt arrives after expiresAt', async () => {
    const { id } = await initiateRecovery(USER_ID, 'phrase', '10.0.0.1');
    db.requests.get(id).expiresAt = new Date(Date.now() - 1000);

    await expect(recordAttempt(id, true)).rejects.toThrow('expired');
    expect(db.requests.get(id).status).toBe('expired');
  });

  it('expires a stale active request so a new recovery can start', async () => {
    const { id } = await initiateRecovery(USER_ID, 'phrase', '10.0.0.1');
    db.requests.get(id).expiresAt = new Date(Date.now() - 1000);

    const next = await initiateRecovery(USER_ID, 'phrase', '10.0.0.1');
    expect(next.id).not.toBe(id);
    expect(db.requests.get(id).status).toBe('expired');
  });

  it('persists cancellation and only lets the owner cancel', async () => {
    const { id } = await initiateRecovery(USER_ID, 'phrase', '10.0.0.1');
    await expect(cancelRecovery(id, 'someone-else')).rejects.toThrow('Unauthorized');

    const cancelled = await cancelRecovery(id, USER_ID);
    expect(cancelled.status).toBe('cancelled');
    expect(db.requests.get(id).cancelledAt).toBeInstanceOf(Date);
    expect(await getActiveRequest(USER_ID)).toBeNull();
  });
});

// ── #1388 Guardian approval tokens ────────────────────────────────────────────

describe('guardian approval tokens (#1388)', () => {
  it('emails each guardian a 32-byte token and stores only its SHA-256 hash', async () => {
    const guardians = addGuardians(USER_ID, 3);
    const { id } = await initiateRecovery(USER_ID, 'social', '10.0.0.1');

    expect(sentEmails).toHaveLength(3);
    const rows = [...db.approvals.values()].filter((a) => a.requestId === id);
    expect(rows).toHaveLength(3);

    for (const g of guardians) {
      const token = tokenFor(g);
      const row = rows.find((r) => r.contactId === g.id);
      expect(row.tokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify([...db.requests.values(), ...db.approvals.values()])).not.toContain(token);
    }
  });

  it('never exposes token hashes through the public request shape', async () => {
    addGuardians(USER_ID, 1);
    const req = await initiateRecovery(USER_ID, 'social', '10.0.0.1');
    expect(JSON.stringify(req)).not.toMatch(/tokenHash/);
    expect(req.approvals).toEqual([]);
  });

  it('refuses social recovery when the user has no confirmed guardians', async () => {
    await expect(initiateRecovery(USER_ID, 'social', '10.0.0.1')).rejects.toThrow('No confirmed recovery contacts');
  });

  it('rejects a contactId without a token as 401', async () => {
    const [g] = addGuardians(USER_ID, 1);
    const { id } = await initiateRecovery(USER_ID, 'social', '10.0.0.1');

    const err = await addApproval(id, g.id).catch((e) => e);
    expect(err).toBeInstanceOf(RecoveryAuthError);
    expect(err.statusCode).toBe(401);
  });

  it('rejects a forged token, another guardian’s token, and an unknown contact as 401', async () => {
    const [a, b] = addGuardians(USER_ID, 2);
    const { id } = await initiateRecovery(USER_ID, 'social', '10.0.0.1');

    await expect(addApproval(id, a.id, crypto.randomBytes(32).toString('hex'))).rejects.toBeInstanceOf(RecoveryAuthError);
    await expect(addApproval(id, a.id, tokenFor(b))).rejects.toBeInstanceOf(RecoveryAuthError);
    await expect(addApproval(id, crypto.randomUUID(), tokenFor(a))).rejects.toBeInstanceOf(RecoveryAuthError);
    expect([...db.approvals.values()].every((r) => r.approvedAt === null)).toBe(true);
  });

  it('records the approval when the matching token is presented', async () => {
    const [a] = addGuardians(USER_ID, 2);
    const { id } = await initiateRecovery(USER_ID, 'social', '10.0.0.1');

    const updated = await addApproval(id, a.id, tokenFor(a));
    expect(updated.approvals).toEqual([a.id]);

    // Replaying the same token is idempotent, not a second approval.
    const replay = await addApproval(id, a.id, tokenFor(a));
    expect(replay.approvals).toEqual([a.id]);
  });

  describe('POST /api/recovery/:requestId/approve', () => {
    let app;
    beforeEach(async () => {
      const { default: router } = await import('../routes/recovery.js');
      app = express().use(express.json()).use('/api/recovery', router);
    });

    it('returns 401 for a spoofed approval lacking a valid token', async () => {
      const [g] = addGuardians(USER_ID, 1);
      const { id } = await initiateRecovery(USER_ID, 'social', '10.0.0.1');

      const missing = await request(app).post(`/api/recovery/${id}/approve`).send({ contactId: g.id });
      expect(missing.status).toBe(401);

      const forged = await request(app)
        .post(`/api/recovery/${id}/approve`)
        .send({ contactId: g.id, approvalToken: 'f'.repeat(64) });
      expect(forged.status).toBe(401);
      expect(db.requests.get(id).status).toBe('pending');
    });

    it('accepts a valid token and approves the request once the majority is reached', async () => {
      const [g] = addGuardians(USER_ID, 1);
      const { id } = await initiateRecovery(USER_ID, 'social', '10.0.0.1');

      const res = await request(app)
        .post(`/api/recovery/${id}/approve`)
        .send({ contactId: g.id, approvalToken: tokenFor(g) });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ approvals: 1, required: 1, status: 'approved' });
    });
  });
});

// ── #1389 On-chain rotation & session teardown ────────────────────────────────

describe('completeRecovery key rotation and teardown (#1389)', () => {
  async function approvedRequest(opts = { newPublicKey: NEW_KEY }) {
    const { id } = await initiateRecovery(USER_ID, 'phrase', '10.0.0.1', opts);
    await recordAttempt(id, true);
    elapseTimeLock(id);
    return id;
  }

  it('rotates signers on-chain, updates user.publicKey, revokes all sessions and notifies', async () => {
    db.refreshTokens.push(
      { jti: 'r1', userId: USER_ID, isRevoked: false },
      { jti: 'r2', userId: USER_ID, isRevoked: false },
      { jti: 'r3', userId: 'other-user', isRevoked: false },
    );
    const id = await approvedRequest();

    const done = await completeRecovery(id);

    expect(rotateRecoveredAccountSigner).toHaveBeenCalledWith({
      accountId: OLD_KEY,
      oldPublicKey: OLD_KEY,
      newPublicKey: NEW_KEY,
      correlationId: id,
    });
    expect(db.users.get(USER_ID).publicKey).toBe(NEW_KEY);
    expect(done).toMatchObject({ status: 'completed', rotationTxHash: 'a'.repeat(64), newPublicKey: NEW_KEY });
    expect(db.requests.get(id).oldPublicKey).toBe(OLD_KEY);

    expect(db.refreshTokens.filter((t) => t.userId === USER_ID).every((t) => t.isRevoked)).toBe(true);
    expect(db.refreshTokens.find((t) => t.jti === 'r3').isRevoked).toBe(false);
    expect(revokeUserTokens).toHaveBeenCalledWith(USER_ID);
    expect(revokeAllSessions).toHaveBeenCalledWith(USER_ID);

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        type: 'account_recovery_completed',
        data: expect.objectContaining({ newPublicKey: NEW_KEY, txHash: 'a'.repeat(64), revokedSessions: 2 }),
      }),
    );
  });

  it('rotates on-chain before touching the database or sessions', async () => {
    const order = [];
    rotateRecoveredAccountSigner.mockImplementationOnce(async () => {
      order.push('chain');
      return { hash: 'b'.repeat(64), ledger: 1 };
    });
    prisma.$transaction.mockImplementationOnce(async (ops) => {
      order.push('db');
      return Promise.all(ops);
    });
    revokeAllSessions.mockImplementationOnce(async () => {
      order.push('sessions');
      return 0;
    });

    await completeRecovery(await approvedRequest());
    expect(order).toEqual(['chain', 'db', 'sessions']);
  });

  it('leaves user, sessions and request untouched when the on-chain rotation fails', async () => {
    rotateRecoveredAccountSigner.mockRejectedValueOnce(new Error('tx_bad_auth'));
    const id = await approvedRequest();

    await expect(completeRecovery(id)).rejects.toThrow('tx_bad_auth');
    expect(db.users.get(USER_ID).publicKey).toBe(OLD_KEY);
    expect(db.requests.get(id).status).toBe('approved');
    expect(revokeAllSessions).not.toHaveBeenCalled();
  });

  it('accepts newPublicKey at completion and rejects one that differs from the bound key', async () => {
    const id = await approvedRequest({});
    await expect(completeRecovery(id)).rejects.toThrow('valid newPublicKey is required');
    await completeRecovery(id, { newPublicKey: NEW_KEY });
    expect(db.users.get(USER_ID).publicKey).toBe(NEW_KEY);

    db.requests.clear();
    db.users.get(USER_ID).publicKey = OLD_KEY;
    const bound = await approvedRequest();
    await expect(completeRecovery(bound, { newPublicKey: Keypair.random().publicKey() })).rejects.toThrow('does not match');
    expect(rotateRecoveredAccountSigner).toHaveBeenCalledTimes(1);
  });

  it('refuses to complete before approval or while the time-lock is active', async () => {
    const { id } = await initiateRecovery(USER_ID, 'phrase', '10.0.0.1', { newPublicKey: NEW_KEY });
    await expect(completeRecovery(id)).rejects.toThrow('Recovery not approved');
    await recordAttempt(id, true);
    await expect(completeRecovery(id)).rejects.toThrow('Time-lock active');
    expect(rotateRecoveredAccountSigner).not.toHaveBeenCalled();
  });

  it('lets only one concurrent completion reach the chain', async () => {
    const id = await approvedRequest();
    await Promise.allSettled([completeRecovery(id), completeRecovery(id)]);
    expect(rotateRecoveredAccountSigner).toHaveBeenCalledTimes(1);
    expect((await getRequest(id)).status).toBe('completed');
  });
});
