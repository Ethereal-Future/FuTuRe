/**
 * Redis fault tolerance and PostgreSQL session fallback (#1385).
 *
 * The Redis client is replaced with a stub whose commands can be made to
 * throw connection errors, and Prisma is replaced with a small in-memory
 * `Session` table.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sessions = vi.hoisted(() => new Map());

vi.mock('../db/client.js', () => ({
  default: {
    session: {
      findFirst: vi.fn(async ({ where }) => {
        const row = sessions.get(where.id);
        if (!row || row.revokedAt !== null || !(row.expiresAt > where.expiresAt.gt)) return null;
        return { ...row };
      }),
    },
  },
}));

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

delete process.env.REDIS_URL;
delete process.env.REDIS_HOST;

const { default: prisma } = await import('../db/client.js');
const { default: logger } = await import('../config/logger.js');
const {
  redisBackend,
  getMobileSession,
  redisGet,
  redisSet,
  getCircuitState,
  resetCircuit,
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_COOLDOWN_MS,
} = await import('./redisStore.js');

function connectionError() {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { code: 'ECONNREFUSED' });
}

function offlineRedisClient() {
  const fail = vi.fn(async () => {
    throw connectionError();
  });
  return { get: fail, set: fail, del: fail, getdel: fail, sadd: fail, srem: fail, smembers: fail };
}

function seedSession(overrides = {}) {
  const row = {
    id: 'sess-1',
    userId: 'user-1',
    deviceId: 'device-1',
    createdAt: new Date(),
    lastActiveAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    revokedAt: null,
    ...overrides,
  };
  sessions.set(row.id, row);
  return row;
}

describe('redisStore — PostgreSQL fallback and circuit breaker (#1385)', () => {
  beforeEach(() => {
    sessions.clear();
    vi.clearAllMocks();
    resetCircuit();
  });

  afterEach(() => {
    redisBackend.client = null;
    vi.useRealTimers();
  });

  it('returns the session from PostgreSQL when Redis throws connection errors', async () => {
    redisBackend.client = offlineRedisClient();
    seedSession();

    const session = await getMobileSession('sess-1');

    expect(session).toMatchObject({ id: 'sess-1', userId: 'user-1', deviceId: 'device-1' });
    expect(redisBackend.client.get).toHaveBeenCalledWith('session:sess-1');
    expect(prisma.session.findFirst).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'mobile.redis.operationFailed',
      expect.objectContaining({ op: 'get' }),
    );
  });

  it('returns the session from PostgreSQL when Redis is completely offline (not configured)', async () => {
    redisBackend.client = null;
    seedSession();

    await expect(getMobileSession('sess-1')).resolves.toMatchObject({ id: 'sess-1' });
    expect(prisma.session.findFirst).toHaveBeenCalledTimes(1);
  });

  it('never rejects on Redis errors, so route handlers cannot surface them as 500s', async () => {
    redisBackend.client = offlineRedisClient();

    await expect(getMobileSession('missing')).resolves.toBeNull();
    await expect(redisGet('k')).resolves.toBeNull();
    await expect(redisSet('k', { v: 1 }, 60)).resolves.toBeUndefined();
    // The write fell back to the in-process store.
    await expect(redisGet('k')).resolves.toEqual({ v: 1 });
  });

  it('does not return revoked or expired sessions from the database fallback', async () => {
    redisBackend.client = offlineRedisClient();
    seedSession({ id: 'revoked', revokedAt: new Date() });
    seedSession({ id: 'expired', expiresAt: new Date(Date.now() - 1000) });

    await expect(getMobileSession('revoked')).resolves.toBeNull();
    await expect(getMobileSession('expired')).resolves.toBeNull();
  });

  it('serves cache hits from Redis without querying PostgreSQL', async () => {
    const row = seedSession();
    redisBackend.client = {
      get: vi.fn(async () => JSON.stringify(row)),
      set: vi.fn(async () => 'OK'),
    };

    await expect(getMobileSession('sess-1')).resolves.toMatchObject({ id: 'sess-1' });
    expect(prisma.session.findFirst).not.toHaveBeenCalled();
  });

  it(`opens the circuit after ${CIRCUIT_FAILURE_THRESHOLD} consecutive failures and bypasses Redis during cooldown`, async () => {
    vi.useFakeTimers();
    redisBackend.client = offlineRedisClient();
    seedSession();

    // Each lookup fails a GET (and, while the breaker is still closed, the cache write-back).
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      await getMobileSession('sess-1');
    }
    expect(getCircuitState().state).toBe('open');

    redisBackend.client.get.mockClear();
    redisBackend.client.set.mockClear();
    await expect(getMobileSession('sess-1')).resolves.toMatchObject({ id: 'sess-1' });
    expect(redisBackend.client.get).not.toHaveBeenCalled();
    expect(redisBackend.client.set).not.toHaveBeenCalled();

    // After the cooldown Redis is attempted again.
    vi.advanceTimersByTime(CIRCUIT_COOLDOWN_MS + 1);
    expect(getCircuitState().state).toBe('closed');
    await getMobileSession('sess-1');
    expect(redisBackend.client.get).toHaveBeenCalledTimes(1);
  });

  it('closes the circuit again once Redis recovers', async () => {
    redisBackend.client = offlineRedisClient();
    await getMobileSession('sess-1');
    expect(getCircuitState().consecutiveFailures).toBeGreaterThan(0);

    redisBackend.client = { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') };
    seedSession();
    await getMobileSession('sess-1');

    expect(getCircuitState()).toMatchObject({ state: 'closed', consecutiveFailures: 0 });
    expect(redisBackend.client.set).toHaveBeenCalledWith(
      'session:sess-1',
      expect.any(String),
      'EX',
      expect.any(Number),
    );
  });
});
