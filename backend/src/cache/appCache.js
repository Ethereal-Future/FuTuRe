/**
 * Application cache singleton.
 * Wires MultiLevelCache (L1 in-memory + L2 Redis) with analytics,
 * invalidation patterns, and warming strategies.
 *
 * TTLs (seconds):
 *   balance      30 s  — short: balances change after payments
 *   exchange rate 60 s  — configurable via RATE_CACHE_TTL_S
 *   fee stats    120 s  — fee stats change slowly
 */

import { MultiLevelCache } from './multi-level.js';
import { CacheAnalytics } from './analytics.js';
import { CacheInvalidator } from './invalidator.js';
import { CacheWarmer } from './warmer.js';
import { CachePerformanceMonitor } from './monitor.js';
import { RedisBackend } from './redis.js';
import { recordCustomMetric } from '../monitoring/metrics.js';

export const TTL = {
  BALANCE: parseInt(process.env.CACHE_TTL_BALANCE_S, 10) || 30,
  RATE: parseInt(process.env.RATE_CACHE_TTL_S, 10) || 60,
  FEE_STATS: parseInt(process.env.CACHE_TTL_FEE_S, 10) || 120,
};

// ── Redis L2 ────────────────────────────────────────────────────────────────
const redisBackend = new RedisBackend(process.env.REDIS_URL || null);
await redisBackend.connect().catch(() => {});

// ── Core cache ──────────────────────────────────────────────────────────────
export const cache = new MultiLevelCache({
  l2: redisBackend,
  ttl: TTL.RATE * 1000,
});

// ── Analytics ───────────────────────────────────────────────────────────────
export const analytics = new CacheAnalytics();

// ── Monitor ─────────────────────────────────────────────────────────────────
export const monitor = new CachePerformanceMonitor();

// ── Invalidator ─────────────────────────────────────────────────────────────
export const invalidator = new CacheInvalidator(cache);

// Register invalidation patterns
invalidator
  .registerPattern('balances', [])          // keys added dynamically per account
  .registerPattern('rates', ['rate:*'])
  .registerPattern('fee_stats', ['fee:stats']);

// ── Warmer ───────────────────────────────────────────────────────────────────
export const warmer = new CacheWarmer(cache);

// ── Key helpers ──────────────────────────────────────────────────────────────
export const keys = {
  balance: (publicKey) => `balance:${publicKey}`,
  rate: (from, to) => `rate:${from}:${to}`,
  feeStats: () => 'fee:stats',
};

// ── Instrumented get/set wrappers ────────────────────────────────────────────
export async function cacheGet(key) {
  const start = Date.now();
  const value = await cache.get(key);
  const hit = value !== null;
  const duration = Date.now() - start;

  if (hit) analytics.recordHit(key);
  else analytics.recordMiss(key);

  monitor.recordOperation('get', duration, hit);
  recordCustomMetric(`cache.${hit ? 'hit' : 'miss'}`, 1, 'count');

  return value;
}

export async function cacheSet(key, value, ttlSeconds) {
  const start = Date.now();
  await cache.set(key, value, ttlSeconds * 1000);
  analytics.recordSet(key, JSON.stringify(value).length);
  monitor.recordOperation('set', Date.now() - start, true);
}

export async function cacheDel(key) {
  await cache.delete(key);
  analytics.recordDelete(key);
}

// ── Invalidate balance for an account (called after payment) ─────────────────
export async function invalidateBalance(publicKey) {
  await cacheDel(keys.balance(publicKey));
}
