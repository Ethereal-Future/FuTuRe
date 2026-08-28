/**
 * Application cache singleton.
 * Wires MultiLevelCache (L1 in-memory + L2 Redis).
 *
 * TTLs (seconds):
 *   balance      30 s  — short: balances change after payments
 *   exchange rate 60 s  — configurable via RATE_CACHE_TTL_S
 *   fee stats    120 s  — fee stats change slowly
 *
 * Note: CacheAnalytics, CacheInvalidator, CacheWarmer, and
 * CachePerformanceMonitor were removed in Issue #1126 (prune unwired
 * subsystems). The cache operates on MultiLevelCache directly.
 */

import { MultiLevelCache } from './multi-level.js';
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

// ── Key helpers ──────────────────────────────────────────────────────────────
export const keys = {
  balance: (publicKey) => `balance:${publicKey}`,
  rate: (from, to) => `rate:${from}:${to}`,
  allRates: () => 'rates:all',
  feeStats: () => 'fee:stats',
};

// ── Instrumented get/set wrappers ────────────────────────────────────────────
export async function cacheGet(key) {
  const start = Date.now();
  const value = await cache.get(key);
  const hit = value !== null;

  recordCustomMetric(`cache.${hit ? 'hit' : 'miss'}`, 1, 'count');

  return value;
}

export async function cacheSet(key, value, ttlSeconds) {
  await cache.set(key, value, ttlSeconds * 1000);
}

export async function cacheDel(key) {
  await cache.delete(key);
}

// ── Invalidate balance for an account (called after payment) ─────────────────
export async function invalidateBalance(publicKey) {
  await cacheDel(keys.balance(publicKey));
}
