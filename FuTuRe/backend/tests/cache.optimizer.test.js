/**
 * Example: Cache Optimizer
 */

import { describe, it, expect } from 'vitest';
import { createCacheOptimizer } from '../src/cache/index.js';

describe('Cache Optimizer', () => {
  it('should set and get with LRU', () => {
    const optimizer = createCacheOptimizer(3);

    optimizer.set('key1', 'value1', 'lru');
    optimizer.set('key2', 'value2', 'lru');

    expect(optimizer.get('key1')).toBe('value1');
  });

  it('should set and get with LRU', () => {
    const optimizer = createCacheOptimizer(3);

    optimizer.set('key1', 'value1', 'lru');
    optimizer.set('key2', 'value2', 'lru');

    expect(optimizer.get('key1')).toBe('value1');
  });

  it('should handle cache at capacity', () => {
    const optimizer = createCacheOptimizer(2);

    optimizer.set('key1', 'value1', 'lru');
    optimizer.set('key2', 'value2', 'lru');

    const stats = optimizer.getStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(2);
  });

  it('should get hot keys', () => {
    const optimizer = createCacheOptimizer(10);

    optimizer.set('key1', 'value1');
    optimizer.get('key1');
    optimizer.get('key1');
    optimizer.get('key1');

    const hotKeys = optimizer.getHotKeys(1);
    expect(hotKeys[0].key).toBe('key1');
    expect(hotKeys[0].accessCount).toBe(3);
  });

  it('should get stats', () => {
    const optimizer = createCacheOptimizer(10);

    optimizer.set('key1', 'value1');
    optimizer.set('key2', 'value2');

    const stats = optimizer.getStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(10);
  });
});
