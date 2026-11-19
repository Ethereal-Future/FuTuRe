/**
 * #1124 / #1379 — Redis-backed, session-bound, single-use WebAuthn challenges.
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
    async getdel(key) {
      // No await between read and delete — atomic, like the real command.
      const entry = store.get(key);
      store.delete(key);
      if (!entry || (entry.expiresAt && Date.now() > entry.expiresAt)) return null;
      return entry.value;
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


  it('consumes a challenge atomically so two instances cannot both redeem it', async () => {
    const credStore = new Map();

    mockPrisma(credStore);
    const instanceA = await import('../../src/mobile/webAuthn.js');
    const options = await instanceA.generateRegistrationOptions('user-multi-3', 'multiuser3');

    vi.resetModules();
    mockPrisma(credStore);
    const instanceB = await import('../../src/mobile/webAuthn.js');

    const results = await Promise.allSettled([
      instanceA.verifyAndStoreRegistration(options.sessionId, { id: 'cred-race-a', publicKey: 'MFkwEw==' }),
      instanceB.verifyAndStoreRegistration(options.sessionId, { id: 'cred-race-b', publicKey: 'MFkwEw==' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  // Mobile sessions moved from Redis into the unified Prisma `Session` table
  // (issue #1381); their cross-instance behaviour is covered by
  // src/mobile/sessions.test.js.
});
