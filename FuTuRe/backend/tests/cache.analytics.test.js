/**
 * Example: Cache Analytics
 */

import { describe, it, expect } from 'vitest';
import { createCacheAnalytics } from '../src/cache/index.js';

describe('Cache Analytics', () => {
  it('should record hits and misses', () => {
    const analytics = createCacheAnalytics();

    analytics.recordHit('key1');
    analytics.recordMiss('key2');

    const metrics = analytics.getMetrics();
    expect(metrics.hits).toBe(1);
    expect(metrics.misses).toBe(1);
  });

  it('should calculate hit rate', () => {
    const analytics = createCacheAnalytics();

    analytics.recordHit('key1');
    analytics.recordHit('key2');
    analytics.recordMiss('key3');

    const metrics = analytics.getMetrics();
    expect(metrics.hitRate).toBe('66.67%');
  });

  it('should track key metrics', () => {
    const analytics = createCacheAnalytics();

    analytics.recordSet('key1', 100);
    analytics.recordHit('key1');
    analytics.recordHit('key1');

    const keyMetrics = analytics.getKeyMetrics('key1');
    expect(keyMetrics.sets).toBe(1);
    expect(keyMetrics.hits).toBe(2);
  });

  it('should get top keys', () => {
    const analytics = createCacheAnalytics();

    analytics.recordHit('key1');
    analytics.recordHit('key1');
    analytics.recordHit('key2');

    const topKeys = analytics.getTopKeys(1);
    expect(topKeys[0].key).toBe('key1');
  });

  it('should get timeline', () => {
    const analytics = createCacheAnalytics();

    analytics.recordHit('key1');
    analytics.recordMiss('key2');

    const timeline = analytics.getTimeline();
    expect(timeline).toHaveLength(2);
  });
});
