/**
 * Example: Cache Invalidation
 */

import { describe, it, expect } from 'vitest';
import { createMultiLevelCache, createCacheInvalidator } from '../src/cache/index.js';

describe('Cache Invalidator', () => {
  it('should register patterns', () => {
    const cache = createMultiLevelCache();
    const invalidator = createCacheInvalidator(cache);

    invalidator.registerPattern('users:*', ['user:1', 'user:2']);

    expect(invalidator.getPatterns()).toHaveLength(1);
  });

  it('should invalidate by pattern', async () => {
    const cache = createMultiLevelCache();
    const invalidator = createCacheInvalidator(cache);

    await cache.set('user:1', { id: 1 });
    await cache.set('user:2', { id: 2 });

    invalidator.registerPattern('users:*', ['user:1', 'user:2']);
    const result = await invalidator.invalidateByPattern('users:*');

    expect(result.invalidated).toBe(2);
  });

  it('should register and invalidate dependencies', async () => {
    const cache = createMultiLevelCache();
    const invalidator = createCacheInvalidator(cache);

    await cache.set('user:1', { id: 1 });
    await cache.set('user:1:posts', []);

    invalidator.registerDependency('user:1', ['user:1:posts']);
    const result = await invalidator.invalidateByKey('user:1');

    expect(result.dependentsInvalidated).toBe(1);
  });

  it('should invalidate by tag', async () => {
    const cache = createMultiLevelCache();
    const invalidator = createCacheInvalidator(cache);

    invalidator.registerPattern('user:*', ['user:1', 'user:2']);
    invalidator.registerPattern('post:*', ['post:1']);

    const result = await invalidator.invalidateByTag('user');

    expect(result.invalidated).toBe(2);
  });
});
