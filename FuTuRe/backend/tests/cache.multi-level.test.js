/**
 * Example: Multi-Level Cache
 */

import { describe, it, expect } from 'vitest';
import { createMultiLevelCache } from '../src/cache/multi-level.js';

describe('Multi-Level Cache', () => {
  it('should set and get from L1', async () => {
    const cache = createMultiLevelCache();
    await cache.set('key1', 'value1');
    const value = await cache.get('key1');
    expect(value).toBe('value1');
  });

  it('should track hits and misses', async () => {
    const cache = createMultiLevelCache();
    await cache.set('key1', 'value1');
    await cache.get('key1');
    await cache.get('key2');

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('should delete keys', async () => {
    const cache = createMultiLevelCache();
    await cache.set('key1', 'value1');
    await cache.delete('key1');
    const value = await cache.get('key1');
    expect(value).toBeNull();
  });

  it('should clear cache', async () => {
    const cache = createMultiLevelCache();
    await cache.set('key1', 'value1');
    await cache.set('key2', 'value2');
    await cache.clear();
    expect(cache.getStats().size).toBe(0);
  });

  it('should handle TTL expiration', async () => {
    const cache = createMultiLevelCache({ ttl: 100 });
    await cache.set('key1', 'value1', 100);
    expect(await cache.get('key1')).toBe('value1');

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await cache.get('key1')).toBeNull();
  });
});
