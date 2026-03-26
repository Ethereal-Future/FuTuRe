/**
 * Example: Cache Warming
 */

import { describe, it, expect } from 'vitest';
import { createMultiLevelCache, createCacheWarmer } from '../src/cache/index.js';

describe('Cache Warmer', () => {
  it('should add warming strategies', () => {
    const cache = createMultiLevelCache();
    const warmer = createCacheWarmer(cache);

    warmer.addStrategy('users', async () => ({ 'user:1': { id: 1, name: 'John' } }));

    expect(warmer.getStrategies()).toHaveLength(1);
  });

  it('should warm cache with strategy', async () => {
    const cache = createMultiLevelCache();
    const warmer = createCacheWarmer(cache);

    warmer.addStrategy('users', async () => ({
      'user:1': { id: 1, name: 'John' },
      'user:2': { id: 2, name: 'Jane' },
    }));

    const result = await warmer.warmStrategy('users');

    expect(result.status).toBe('success');
    expect(result.itemsWarmed).toBe(2);
  });

  it('should warm all strategies', async () => {
    const cache = createMultiLevelCache();
    const warmer = createCacheWarmer(cache);

    warmer.addStrategy('users', async () => ({ 'user:1': { id: 1 } }));
    warmer.addStrategy('posts', async () => ({ 'post:1': { id: 1 } }));

    const results = await warmer.warmAll();

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });
});
