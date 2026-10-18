/**
 * Shared Redis-backed storage for mobile WebAuthn challenges and mobile
 * sessions (issue #1124). Both `mobile/webAuthn.js` and `mobile/sessions.js`
 * use this so challenges/sessions created by one server instance are visible
 * to every other instance behind the load balancer — the previous
 * in-process `Map`s were only ever correct for a single instance.
 *
 * Falls back to an in-process Map when Redis isn't configured (e.g. local
 * dev, or tests that don't set REDIS_URL/REDIS_HOST) so single-instance use
 * keeps working without a Redis deployment — this mirrors the fail-open
 * behavior `cache/redis.js` already uses elsewhere in the app. The fallback
 * is NOT shared across processes; only real Redis is.
 *
 * Fault tolerance (issue #1385): every Redis call goes through a circuit
 * breaker. A Redis error is logged and the operation falls back (to
 * PostgreSQL for sessions, to the in-process store for other keys) instead
 * of bubbling up to route handlers as a 500 / forced logout. After
 * CIRCUIT_FAILURE_THRESHOLD consecutive failures Redis is bypassed entirely
 * for CIRCUIT_COOLDOWN_MS before it is tried again.
 */
import { RedisBackend } from '../cache/redis.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

export const redisBackend = new RedisBackend();

export const CIRCUIT_FAILURE_THRESHOLD = 5;
export const CIRCUIT_COOLDOWN_MS = 30_000;

// ── Circuit breaker ─────────────────────────────────────────────────────────

const circuit = {
  consecutiveFailures: 0,
  openUntil: 0,
};

function isCircuitOpen() {
  return circuit.openUntil > Date.now();
}

function recordSuccess() {
  circuit.consecutiveFailures = 0;
  circuit.openUntil = 0;
}

function recordFailure(op, err) {
  circuit.consecutiveFailures += 1;
  logger.warn('mobile.redis.operationFailed', {
    op,
    error: err?.message,
    consecutiveFailures: circuit.consecutiveFailures,
  });
  if (circuit.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD && !isCircuitOpen()) {
    circuit.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    logger.warn('mobile.redis.circuitOpen', { cooldownMs: CIRCUIT_COOLDOWN_MS });
  }
}

/** @returns {{ state: 'open'|'closed', consecutiveFailures: number, openUntil: number }} */
export function getCircuitState() {
  return {
    state: isCircuitOpen() ? 'open' : 'closed',
    consecutiveFailures: circuit.consecutiveFailures,
    openUntil: circuit.openUntil,
  };
}

/** Test helper: reset the breaker to a closed state. */
export function resetCircuit() {
  recordSuccess();
}

function isRedisConfigured() {
  return Boolean(redisBackend.client);
}

/** Redis is configured and the breaker currently allows calls through. */
function isRedisAvailable() {
  return isRedisConfigured() && !isCircuitOpen();
}

/** @returns {boolean} Whether mobile auth is backed by real (shared) Redis storage right now. */
export function isMobileRedisAvailable() {
  return isRedisAvailable();
}

/**
 * Run `fn` against the raw Redis client. Resolves `{ ok: true, value }` on
 * success and `{ ok: false }` on failure (after recording it on the breaker),
 * so callers decide their own fallback and errors never escape.
 */
async function tryRedis(op, fn) {
  try {
    const value = await fn(redisBackend.client);
    recordSuccess();
    return { ok: true, value };
  } catch (err) {
    recordFailure(op, err);
    return { ok: false };
  }
}

// ── In-process fallback (single instance / no Redis configured) ────────────

const memoryValues = new Map(); // key -> { value, expiresAt: number|null }
const memorySets = new Map(); // key -> Set<string>

function memoryGet(key) {
  const entry = memoryValues.get(key);
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    memoryValues.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key, value, ttlSeconds) {
  memoryValues.set(key, {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
}

// ── Public key/value API ────────────────────────────────────────────────────

export async function redisGet(key) {
  if (isRedisAvailable()) {
    const result = await tryRedis('get', (client) => client.get(key));
    if (result.ok) return result.value ? JSON.parse(result.value) : null;
  }
  return memoryGet(key);
}

export async function redisSet(key, value, ttlSeconds) {
  if (isRedisAvailable()) {
    const raw = JSON.stringify(value);
    const result = await tryRedis('set', (client) =>
      ttlSeconds ? client.set(key, raw, 'EX', ttlSeconds) : client.set(key, raw),
    );
    if (result.ok) return;
  }
  memorySet(key, value, ttlSeconds);
}

export async function redisDelete(key) {
  memoryValues.delete(key);
  if (isRedisAvailable()) await tryRedis('del', (client) => client.del(key));
}

/**
 * Atomically read and delete `key` (Redis GETDEL), so two concurrent readers
 * can never both observe the same value. Used for single-use secrets such as
 * WebAuthn challenges and attestation nonces (issues #1379, #1382).
 *
 * Unlike get/set this does NOT fail open: a Redis error is rethrown so a
 * caller can never mistake "Redis unavailable" for a successful consume.
 * While the breaker is open, values written during the outage live in the
 * in-process store, so they are consumed from there.
 */
export async function redisGetDelete(key) {
  if (isRedisAvailable()) {
    let raw;
    try {
      raw = await redisBackend.client.getdel(key);
    } catch (err) {
      recordFailure('getdel', err);
      throw err;
    }
    recordSuccess();
    if (raw) return JSON.parse(raw);
    // Fall through: the value may have been written locally while the breaker was open.
  }
  // Single-threaded event loop: read + delete with no await in between is atomic.
  const value = memoryGet(key);
  memoryValues.delete(key);
  return value;
}

// ── Public set API (used for the per-user session index) ───────────────────

export async function redisSetAdd(setKey, member) {
  if (isRedisAvailable()) {
    const result = await tryRedis('sadd', (client) => client.sadd(setKey, member));
    if (result.ok) return;
  }
  if (!memorySets.has(setKey)) memorySets.set(setKey, new Set());
  memorySets.get(setKey).add(member);
}

export async function redisSetRemove(setKey, member) {
  memorySets.get(setKey)?.delete(member);
  if (isRedisAvailable()) await tryRedis('srem', (client) => client.srem(setKey, member));
}

export async function redisSetMembers(setKey) {
  if (isRedisAvailable()) {
    const result = await tryRedis('smembers', (client) => client.smembers(setKey));
    if (result.ok) return result.value;
  }
  return [...(memorySets.get(setKey) ?? [])];
}

// ── Mobile sessions: Redis read-through with PostgreSQL fallback (#1385) ───

// Same key layout as auth/sessionStore.js, so revocations there invalidate
// entries cached here.
const sessionKey = (sessionId) => `session:${sessionId}`;

function isSessionActive(session) {
  return Boolean(session) && !session.revokedAt && new Date(session.expiresAt) > new Date();
}

/**
 * Resolve an active mobile session. Redis is only a cache: when it is
 * offline, throwing, or the breaker is open, the session is read straight
 * from `prisma.session`, so a Redis outage never logs mobile users out.
 *
 * @param {string} sessionId
 * @returns {Promise<object|null>} The session row, or null when missing, expired or revoked.
 */
export async function getMobileSession(sessionId) {
  if (!sessionId) return null;

  if (isRedisAvailable()) {
    const result = await tryRedis('get', (client) => client.get(sessionKey(sessionId)));
    if (result.ok && result.value) {
      let cached = null;
      try {
        cached = JSON.parse(result.value);
      } catch {
        /* corrupt cache entry — fall through to the database */
      }
      if (cached) return isSessionActive(cached) ? cached : null;
    }
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  if (!session) return null;

  if (isRedisAvailable()) {
    const ttlSec = Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000);
    if (ttlSec > 0) {
      await tryRedis('set', (client) =>
        client.set(sessionKey(sessionId), JSON.stringify(session), 'EX', ttlSec),
      );
    }
  }
  return session;
}
