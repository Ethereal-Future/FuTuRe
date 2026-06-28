import { RedisBackend } from './redis.js';
import logger from '../config/logger.js';

const TTL = parseInt(process.env.BALANCE_CACHE_TTL_SECONDS ?? '10', 10);

let _backend = null;
function backend() {
  if (!_backend) _backend = new RedisBackend(process.env.REDIS_URL ?? null);
  return _backend;
}

/**
 * Return a cached balance for accountId, or call fetchFn to populate it.
 * Falls open on Redis errors — balance fetch is never blocked by cache failure.
 */
export async function getCachedBalance(accountId, fetchFn) {
  const key = `balance:${accountId}`;
  try {
    const cached = await backend().get(key);
    if (cached !== null) {
      logger.debug('cache.balance.hit', { accountId });
      return cached;
    }
  } catch {
    // Redis unavailable — fall through to live fetch
  }

  const value = await fetchFn();

  try {
    await backend().set(key, value, TTL);
  } catch {
    // Non-critical — serve the value even if caching fails
  }

  return value;
}

/**
 * Invalidate the cached balance for accountId.
 * Called immediately after a successful transaction so the next balance fetch is live.
 */
export async function invalidateBalanceCache(accountId) {
  try {
    await backend().delete(`balance:${accountId}`);
  } catch {
    // Non-critical
  }
}
