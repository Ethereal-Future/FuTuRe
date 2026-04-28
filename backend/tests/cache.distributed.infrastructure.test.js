import { describe, expect, it } from 'vitest';
import { createDistributedCache } from '../src/cache/distributed.js';

function createClusteredCache() {
  const cache = createDistributedCache();
  cache.configureCluster({
    nodes: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }],
    replicationFactor: 2,
    encryptionKey: 'cluster-secret',
  });
  return cache;
}

describe('Distributed cache infrastructure', () => {
  it('configures cluster partitioning for high availability', async () => {
    const cache = createClusteredCache();
    const nodeId = cache.getPartitionForKey('user:1');
    expect(['n1', 'n2', 'n3']).toContain(nodeId);

    await cache.set('user:1', { id: 1, name: 'A' }, 30);
    const value = await cache.get('user:1');
    expect(value.name).toBe('A');
  });

  it('supports replication and failover', async () => {
    const cache = createClusteredCache();
    await cache.set('session:1', { token: 'abc' }, 30);
    const primary = cache.getPartitionForKey('session:1');

    cache.markNodeStatus(primary, 'down');
    const value = await cache.get('session:1');
    expect(value.token).toBe('abc');
  });

  it('supports cache warming and preloading', async () => {
    const cache = createClusteredCache();
    const warmResult = await cache.warm({ 'a': 1, 'b': 2 }, 10);
    expect(warmResult.warmed).toBe(2);

    const preloadResult = await cache.preload(async (key) => `v:${key}`, ['x', 'y'], 10);
    expect(preloadResult.preloaded).toBe(2);
    expect(await cache.get('x')).toBe('v:x');
  });

  it('tracks analytics and optimization signals', async () => {
    const cache = createClusteredCache();
    await cache.set('k1', 'v1', 10);
    await cache.get('k1');
    await cache.get('missing-key');

    const analytics = cache.getAnalytics();
    expect(analytics.reads).toBe(2);
    expect(analytics.writes).toBe(1);

    const optimization = cache.optimize();
    expect(optimization.recommendation).toBeTruthy();
  });

  it('supports encrypted values and backup recovery', async () => {
    const cache = createClusteredCache();
    await cache.set('secure:key', { val: 'sensitive' }, 20);

    const backup = cache.createBackup();
    const restored = createDistributedCache();
    restored.configureCluster({
      nodes: [{ id: 'r1' }],
      replicationFactor: 1,
      encryptionKey: 'cluster-secret',
    });
    restored.restoreBackup(backup);
    restored.encryptionKey = 'cluster-secret';

    const value = await restored.get('secure:key');
    expect(value.val).toBe('sensitive');
  });
});