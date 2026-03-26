/**
 * Example: Cache Debugger
 */

import { describe, it, expect } from 'vitest';
import { createMultiLevelCache, createCacheDebugger } from '../src/cache/index.js';

describe('Cache Debugger', () => {
  it('should inspect cache', async () => {
    const cache = createMultiLevelCache();
    const dbg = createCacheDebugger(cache);

    await cache.set('key1', 'value1');

    const inspection = dbg.inspect();
    expect(inspection).toHaveProperty('timestamp');
    expect(inspection).toHaveProperty('stats');
  });

  it('should take snapshots', async () => {
    const cache = createMultiLevelCache();
    const dbg = createCacheDebugger(cache);

    await cache.set('key1', 'value1');
    dbg.takeSnapshot('initial');

    await cache.set('key2', 'value2');
    dbg.takeSnapshot('after_set');

    const snapshots = dbg.getSnapshots();
    expect(snapshots).toHaveLength(2);
  });

  it('should compare snapshots', async () => {
    const cache = createMultiLevelCache();
    const dbg = createCacheDebugger(cache);

    dbg.takeSnapshot('snap1');
    await cache.set('key1', 'value1');
    dbg.takeSnapshot('snap2');

    const comparison = dbg.compareSnapshots(0, 1);
    expect(comparison).toHaveProperty('timeDiff');
    expect(comparison).toHaveProperty('statsDiff');
  });

  it('should dump cache', async () => {
    const cache = createMultiLevelCache();
    const dbg = createCacheDebugger(cache);

    await cache.set('key1', 'value1');
    const dump = dbg.dumpCache();

    expect(dump.totalEntries).toBe(1);
    expect(dump.entries).toHaveLength(1);
  });

  it('should find expired entries', async () => {
    const cache = createMultiLevelCache({ ttl: 50 });
    const dbg = createCacheDebugger(cache);

    await cache.set('key1', 'value1', 50);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const leaks = dbg.findLeaks();
    expect(leaks.length).toBeGreaterThan(0);
  });
});
