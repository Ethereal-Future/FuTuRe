import { describe, it, expect, afterEach } from 'vitest';
import { resolveRedisConfig } from '../src/cache/redis.js';

const ORIGINAL = { ...process.env };

function restoreEnv() {
  for (const key of ['REDIS_URL', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_AUTH_TOKEN', 'REDIS_PASSWORD', 'REDIS_TLS']) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
}

describe('resolveRedisConfig', () => {
  afterEach(restoreEnv);

  it('returns null when Redis is not configured', () => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_AUTH_TOKEN;
    delete process.env.REDIS_TLS;
    expect(resolveRedisConfig()).toBeNull();
  });

  it('enables TLS for rediss:// URLs', () => {
    delete process.env.REDIS_TLS;
    const resolved = resolveRedisConfig('rediss://:token@redis.example:6379');
    expect(resolved.tlsEnabled).toBe(true);
    expect(resolved.options.tls).toEqual({});
  });

  it('enables TLS and AUTH from REDIS_HOST / REDIS_AUTH_TOKEN / REDIS_TLS', () => {
    delete process.env.REDIS_URL;
    process.env.REDIS_HOST = 'my-redis.cache.amazonaws.com';
    process.env.REDIS_PORT = '6379';
    process.env.REDIS_AUTH_TOKEN = 'from-secrets-manager';
    process.env.REDIS_TLS = 'true';

    const resolved = resolveRedisConfig();
    expect(resolved.url).toBeUndefined();
    expect(resolved.options.host).toBe('my-redis.cache.amazonaws.com');
    expect(resolved.options.password).toBe('from-secrets-manager');
    expect(resolved.options.tls).toEqual({});
    expect(resolved.tlsEnabled).toBe(true);
  });

  it('does not enable TLS for plaintext redis:// without REDIS_TLS', () => {
    delete process.env.REDIS_TLS;
    delete process.env.REDIS_AUTH_TOKEN;
    const resolved = resolveRedisConfig('redis://localhost:6379');
    expect(resolved.tlsEnabled).toBe(false);
    expect(resolved.options.tls).toBeUndefined();
  });
});
