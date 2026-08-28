/**
 * #1124 — Redis-backed WebAuthn challenges and mobile session store.
 *
 * Simulates two distinct server instances (e.g. two ECS tasks behind a load
 * balancer) that each hold their own module state but share the same Redis
 * server. `ioredis` is mocked with a small in-memory server-like store that
 * is *shared across every mocked client instance* (module-scoped state
 * created via vi.hoisted, so it survives `vi.resetModules()`), while every
 * application module is re-imported fresh per "instance" via
 * `vi.resetModules()` + dynamic `import()` — mirroring a real second process
 * that only shares the network connection to Redis, not any in-process state.
 *
 * If any of this fell back to the previous in-process Maps, "instance B"
 * would never see what "instance A" wrote and every assertion below would
 * fail.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Fake Redis server, shared across every mocked client instance ──────────
const FakeRedis = vi.hoisted(() => {
  const store = new Map(); // key -> { value: string, expiresAt: number|null }
  const sets = new Map(); // key -> Set<string>

  return class FakeRedis {
    constructor() {
      this.status = 'ready';
    }
    on() {}
    async connect() {}
    async quit() {}
    async ping() {
      return 'PONG';
    }
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }
    async set(key, value, ...args) {
      const exIdx = args.indexOf('EX');
      const ttl = exIdx !== -1 ? Number(args[exIdx + 1]) : null;
      store.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : null });
      return 'OK';
    }
    async del(key) {
      return store.delete(key) ? 1 : 0;
    }
    async sadd(key, member) {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key).add(member);
      return 1;
    }
    async srem(key, member) {
      sets.get(key)?.delete(member);
      return 1;
    }
    async smembers(key) {
      return [...(sets.get(key) ?? [])];
    }
    async flushdb() {
      store.clear();
      sets.clear();
    }
  };
});

vi.mock('ioredis', () => ({ default: FakeRedis }));

function mockPrisma(credStore) {
  vi.doMock('../../src/db/client.js', () => ({
    default: {
      webAuthnCredential: {
        create: vi.fn(({ data }) => {
          const cred = { ...data };
          credStore.set(data.credentialId, cred);
          return Promise.resolve(cred);
        }),
        findUnique: vi.fn(({ where }) => Promise.resolve(credStore.get(where.credentialId) ?? null)),
        findMany: vi.fn(({ where }) =>
          Promise.resolve(
            [...credStore.values()]
              .filter((c) => c.userId === where.userId)
              .map((c) => ({ credentialId: c.credentialId })),
          ),
        ),
        update: vi.fn(({ where, data }) => {
          const cred = credStore.get(where.credentialId);
          Object.assign(cred, data);
          return Promise.resolve(cred);
        }),
      },
    },
  }));
}

describe('#1124 - Redis-backed mobile auth (multi-instance)', () => {
  beforeEach(() => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    vi.resetModules();
  });

  it('lets a second instance complete WebAuthn registration started on the first', async () => {
    const credStore = new Map();

    mockPrisma(credStore);
    const instanceA = await import('../../src/mobile/webAuthn.js');
    const options = await instanceA.generateRegistrationOptions('user-multi-1', 'multiuser');
    expect(options.challengeId).toBeDefined();

    // Simulate a second, independent server process picking up the request.
    vi.resetModules();
    mockPrisma(credStore);
    const instanceB = await import('../../src/mobile/webAuthn.js');

    const result = await instanceB.verifyAndStoreRegistration(
      options.challengeId,
      { id: 'cred-multi-1', publicKey: 'MFkwEw==' },
      'Multi-instance device',
    );

    expect(result.registered).toBe(true);
    expect(credStore.has('cred-multi-1')).toBe(true);
  });

  it('rejects a challenge that was already consumed by another instance', async () => {
    const credStore = new Map();

    mockPrisma(credStore);
    const instanceA = await import('../../src/mobile/webAuthn.js');
    const options = await instanceA.generateRegistrationOptions('user-multi-2', 'multiuser2');
    await instanceA.verifyAndStoreRegistration(
      options.challengeId,
      { id: 'cred-multi-2', publicKey: 'MFkwEw==' },
    );

    vi.resetModules();
    mockPrisma(credStore);
    const instanceB = await import('../../src/mobile/webAuthn.js');

    await expect(
      instanceB.verifyAndStoreRegistration(options.challengeId, {
        id: 'cred-multi-2-replay',
        publicKey: 'MFkwEw==',
      }),
    ).rejects.toThrow('Registration challenge expired or not found');
  });

  it('shares a mobile session across two instances, including listing and revocation', async () => {
    const instanceA = await import('../../src/mobile/sessions.js');
    const sessionId = await instanceA.default.create('user-sess-1', 'device-1', { app: 'ios' });
    expect(sessionId).toBeDefined();

    // Instance B (fresh module registry) reads the session instance A wrote.
    vi.resetModules();
    const instanceB = await import('../../src/mobile/sessions.js');

    const session = await instanceB.default.get(sessionId);
    expect(session).not.toBeNull();
    expect(session.userId).toBe('user-sess-1');
    expect(session.deviceId).toBe('device-1');

    const listed = await instanceB.default.listForUser('user-sess-1');
    expect(listed.map((s) => s.sessionId)).toContain(sessionId);

    const revokedCount = await instanceB.default.revokeAll('user-sess-1');
    expect(revokedCount).toBeGreaterThanOrEqual(1);

    // A third instance must see the revocation too.
    vi.resetModules();
    const instanceC = await import('../../src/mobile/sessions.js');
    expect(await instanceC.default.get(sessionId)).toBeNull();
    expect(await instanceC.default.listForUser('user-sess-1')).toEqual([]);
  });

  it('persists a session across a simulated process restart', async () => {
    const instanceA = await import('../../src/mobile/sessions.js');
    const sessionId = await instanceA.default.create('user-restart', 'device-9');

    // Simulate the process restarting entirely — a fresh module registry,
    // same (mocked) Redis server.
    vi.resetModules();
    const restarted = await import('../../src/mobile/sessions.js');
    const session = await restarted.default.get(sessionId);

    expect(session).not.toBeNull();
    expect(session.deviceId).toBe('device-9');
  });

  it('revoking a single session on one instance is visible on another', async () => {
    const instanceA = await import('../../src/mobile/sessions.js');
    const keep = await instanceA.default.create('user-partial-revoke', 'device-keep');
    const drop = await instanceA.default.create('user-partial-revoke', 'device-drop');

    vi.resetModules();
    const instanceB = await import('../../src/mobile/sessions.js');
    await instanceB.default.revoke(drop);

    vi.resetModules();
    const instanceC = await import('../../src/mobile/sessions.js');
    const remaining = await instanceC.default.listForUser('user-partial-revoke');
    expect(remaining.map((s) => s.sessionId)).toEqual([keep]);
  });
});
