/**
 * Redis cache backend adapter.
 * Wraps ioredis with the get/set/delete/clear interface expected by MultiLevelCache.
 * Falls back silently to no-op if Redis is not configured or unreachable.
 */

let Redis;
try {
  ({ default: Redis } = await import('ioredis'));
} catch {
  // ioredis not installed — Redis backend disabled
}

export class RedisBackend {
  constructor(url) {
    if (!Redis || !url) {
      this.client = null;
      return;
    }
    this.client = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
    });
    this.client.on('error', () => {}); // suppress unhandled error events
  }

  async connect() {
    if (!this.client) return;
    try { await this.client.connect(); } catch { /* fall through */ }
  }

  async disconnect() {
    if (!this.client) return;
    try { await this.client.quit(); } catch { /* fall through */ }
  }

  async get(key) {
    if (!this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  async set(key, value, ttlSeconds) {
    if (!this.client) return;
    try {
      const raw = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.set(key, raw, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, raw);
      }
    } catch { /* fall through */ }
  }

  /**
   * Atomically claim `key` iff it doesn't already exist (SET ... NX EX).
   * Returns true if this call claimed the key, false if it was already held.
   * No Redis configured means no coordination is possible, so callers are
   * always allowed to proceed (matches the fail-open behavior of get/set).
   * Errors are intentionally NOT swallowed here — callers use them to decide
   * whether to log/alert on the bypass.
   */
  async setNX(key, value, ttlSeconds) {
    if (!this.client) return true;
    const raw = JSON.stringify(value);
    const result = ttlSeconds
      ? await this.client.set(key, raw, 'EX', ttlSeconds, 'NX')
      : await this.client.set(key, raw, 'NX');
    return result === 'OK';
  }

  async delete(key) {
    if (!this.client) return;
    try { await this.client.del(key); } catch { /* fall through */ }
  }

  async clear() {
    if (!this.client) return;
    try { await this.client.flushdb(); } catch { /* fall through */ }
  }

  isAvailable() {
    return this.client?.status === 'ready';
  }
}

export const createRedisBackend = (url) => new RedisBackend(url);
