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
 */
import { RedisBackend } from '../cache/redis.js';

export const redisBackend = new RedisBackend();

function isRedisAvailable() {
  return Boolean(redisBackend.client);
}

/** @returns {boolean} Whether mobile auth is backed by real (shared) Redis storage right now. */
export function isMobileRedisAvailable() {
  return isRedisAvailable();
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
  if (isRedisAvailable()) return redisBackend.get(key);
  return memoryGet(key);
}

export async function redisSet(key, value, ttlSeconds) {
  if (isRedisAvailable()) return redisBackend.set(key, value, ttlSeconds);
  memorySet(key, value, ttlSeconds);
}

export async function redisDelete(key) {
  if (isRedisAvailable()) return redisBackend.delete(key);
  memoryValues.delete(key);
}

// ── Public set API (used for the per-user session index) ───────────────────

export async function redisSetAdd(setKey, member) {
  if (isRedisAvailable()) {
    try {
      await redisBackend.client.sadd(setKey, member);
    } catch {
      /* fail open, matching RedisBackend's own get/set behavior */
    }
    return;
  }
  if (!memorySets.has(setKey)) memorySets.set(setKey, new Set());
  memorySets.get(setKey).add(member);
}

export async function redisSetRemove(setKey, member) {
  if (isRedisAvailable()) {
    try {
      await redisBackend.client.srem(setKey, member);
    } catch {
      /* fall through */
    }
    return;
  }
  memorySets.get(setKey)?.delete(member);
}

export async function redisSetMembers(setKey) {
  if (isRedisAvailable()) {
    try {
      return await redisBackend.client.smembers(setKey);
    } catch {
      return [];
    }
  }
  return [...(memorySets.get(setKey) ?? [])];
}
