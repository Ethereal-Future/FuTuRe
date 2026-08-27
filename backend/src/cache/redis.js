/**
 * Redis cache backend adapter.
 * Wraps ioredis with the get/set/delete/clear interface expected by MultiLevelCache.
 * Falls back silently to no-op if Redis is not configured or unreachable.
 *
 * Production (ECS) connection is host + AUTH token + TLS, not a plaintext
 * redis:// URL: REDIS_HOST, REDIS_PORT, REDIS_AUTH_TOKEN, REDIS_TLS=true.
 * REDIS_URL (redis:// or rediss://) remains supported for local/dev.
 */

const REDIS_CLIENT_DEFAULTS = {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 3000,
};

function envFlag(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ['1', 'true', 'yes', 'y', 'on'].includes(raw);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

/**
 * Resolve ioredis constructor args from an optional URL and process.env.
 * TLS is enabled when REDIS_TLS is truthy or the URL uses the rediss:// scheme.
 */
export function resolveRedisConfig(url) {
  const fromArg = nonEmpty(url);
  const fromEnv = nonEmpty(process.env.REDIS_URL);
  const resolvedUrl = fromArg || fromEnv;
  const host = nonEmpty(process.env.REDIS_HOST);
  const password =
    nonEmpty(process.env.REDIS_AUTH_TOKEN) || nonEmpty(process.env.REDIS_PASSWORD) || undefined;
  const portRaw = Number.parseInt(process.env.REDIS_PORT || '6379', 10);
  const port = Number.isFinite(portRaw) ? portRaw : 6379;
  const tlsEnabled = envFlag(process.env.REDIS_TLS) || resolvedUrl.startsWith('rediss://');

  if (resolvedUrl) {
    const options = { ...REDIS_CLIENT_DEFAULTS };
    if (password) options.password = password;
    if (tlsEnabled) options.tls = {};
    return { url: resolvedUrl, options, tlsEnabled };
  }

  if (host) {
    const options = {
      ...REDIS_CLIENT_DEFAULTS,
      host,
      port,
    };
    if (password) options.password = password;
    if (tlsEnabled) options.tls = {};
    return { options, tlsEnabled };
  }

  return null;
}

let Redis;
try {
  ({ default: Redis } = await import('ioredis'));
} catch {
  // ioredis not installed — Redis backend disabled
}

export class RedisBackend {
  constructor(url) {
    const resolved = resolveRedisConfig(url);
    this.tlsEnabled = Boolean(resolved?.tlsEnabled);
    if (!Redis || !resolved) {
      this.client = null;
      return;
    }
    this.client = resolved.url
      ? new Redis(resolved.url, resolved.options)
      : new Redis(resolved.options);
    this.client.on('error', () => {}); // suppress unhandled error events
  }

  isTlsEnabled() {
    return this.tlsEnabled && this.client != null;
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
