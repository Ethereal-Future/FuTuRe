/**
 * Tests for the non-blocking bottleneck analyzer (#1416).
 *
 * The key change is that profiling (event-loop lag + CPU measurement) now
 * runs inside a worker_threads Worker so the main thread is never blocked.
 *
 * These tests verify:
 *  1. The existing analyze() / calculateSeverity() / getRecommendations() API
 *     is fully preserved.
 *  2. startProfiling() / stopProfiling() operate without throwing.
 *  3. getProfilingSnapshot() returns a valid structure after profiling.
 *  4. Calling stopProfiling() without a running worker is a no-op.
 */
import { describe, it, expect, afterEach } from 'vitest';
import bottleneckAnalyzer from '../src/loadTesting/bottleneckAnalyzer.js';

afterEach(async () => {
  // Clean up any worker that a test may have left running.
  await bottleneckAnalyzer.stopProfiling();
});

// ─── analyze() — backward-compatibility ──────────────────────────────────────
describe('BottleneckAnalyzer.analyze (static, backward-compatible)', () => {
  it('returns empty array when no requests are slow or error-prone', () => {
    const results = [
      { method: 'GET', path: '/api/health', responseTime: 50, success: true },
      { method: 'GET', path: '/api/health', responseTime: 60, success: true },
    ];
    expect(bottleneckAnalyzer.analyze(results)).toHaveLength(0);
  });

  it('identifies a slow endpoint as a bottleneck', () => {
    const results = Array.from({ length: 20 }, () => ({
      method: 'GET',
      path: '/api/slow',
      responseTime: 800,
      success: true,
    }));
    const bottlenecks = bottleneckAnalyzer.analyze(results);
    expect(bottlenecks).toHaveLength(1);
    expect(bottlenecks[0].endpoint).toBe('GET /api/slow');
    expect(bottlenecks[0].avgResponseTime).toBe(800);
  });

  it('identifies a high-error-rate endpoint', () => {
    const results = [
      ...Array.from({ length: 5 }, () => ({
        method: 'POST', path: '/api/pay', responseTime: 100, success: false,
      })),
      ...Array.from({ length: 5 }, () => ({
        method: 'POST', path: '/api/pay', responseTime: 100, success: true,
      })),
    ];
    const bottlenecks = bottleneckAnalyzer.analyze(results);
    expect(bottlenecks).toHaveLength(1);
    expect(bottlenecks[0].errorRate).toBe(50);
  });

  it('sorts bottlenecks by severity descending', () => {
    const results = [
      // Low severity: avg > 500 only
      ...Array.from({ length: 10 }, () => ({
        method: 'GET', path: '/api/medium', responseTime: 600, success: true,
      })),
      // High severity: avg > 1000 + high error rate
      ...Array.from({ length: 10 }, () => ({
        method: 'GET', path: '/api/critical', responseTime: 1500, success: false,
      })),
    ];
    const bottlenecks = bottleneckAnalyzer.analyze(results);
    expect(bottlenecks[0].endpoint).toBe('GET /api/critical');
    expect(bottlenecks[0].severity).toBeGreaterThan(bottlenecks[1].severity);
  });
});

// ─── calculateSeverity() ────────────────────────────────────────────────────
describe('BottleneckAnalyzer.calculateSeverity', () => {
  it('returns 0 for a fast, clean endpoint', () => {
    expect(bottleneckAnalyzer.calculateSeverity(50, 100, 0)).toBe(0);
  });

  it('accumulates severity correctly for avg > 1000 + p95 > 2000 + error > 10', () => {
    // 3 + 3 + 3 = 9
    expect(bottleneckAnalyzer.calculateSeverity(1500, 3000, 15)).toBe(9);
  });
});

// ─── getRecommendations() ───────────────────────────────────────────────────
describe('BottleneckAnalyzer.getRecommendations', () => {
  it('returns empty array when no bottlenecks', () => {
    expect(bottleneckAnalyzer.getRecommendations([])).toHaveLength(0);
  });

  it('includes CRITICAL recommendation for high error rate', () => {
    const bottlenecks = [{
      endpoint: 'POST /api/pay',
      avgResponseTime: 200,
      p95ResponseTime: 500,
      errorRate: 20,
      severity: 5,
    }];
    const recs = bottleneckAnalyzer.getRecommendations(bottlenecks);
    expect(recs.some((r) => r.priority === 'CRITICAL')).toBe(true);
  });
});

// ─── Worker-based profiling ─────────────────────────────────────────────────
describe('BottleneckAnalyzer worker profiling (non-blocking)', () => {
  it('getProfilingSnapshot returns zeroes before any profiling', () => {
    const snap = bottleneckAnalyzer.getProfilingSnapshot();
    expect(snap).toMatchObject({
      sampleCount: 0,
      avgEventLoopLagMs: 0,
      p95EventLoopLagMs: 0,
      maxEventLoopLagMs: 0,
      avgCpuPercent: 0,
      maxCpuPercent: 0,
    });
  });

  it('stopProfiling resolves immediately when no worker is running', async () => {
    await expect(bottleneckAnalyzer.stopProfiling()).resolves.toBeUndefined();
  });

  it(
    'startProfiling resolves, collects samples over time, stopProfiling terminates cleanly',
    async () => {
      await bottleneckAnalyzer.startProfiling({ intervalMs: 20, maxSamples: 5 });

      // Wait long enough for the worker to collect a few samples.
      await new Promise((resolve) => setTimeout(resolve, 200));

      await bottleneckAnalyzer.stopProfiling();

      const snap = bottleneckAnalyzer.getProfilingSnapshot();
      // We may not have exactly 5 samples depending on timing, but we expect
      // at least 1 to have been collected in 200 ms with a 20 ms interval.
      expect(snap.sampleCount).toBeGreaterThanOrEqual(1);
      expect(snap.avgEventLoopLagMs).toBeGreaterThanOrEqual(0);
      expect(snap.avgCpuPercent).toBeGreaterThanOrEqual(0);
    },
    { timeout: 5000 },
  );

  it('calling startProfiling twice does not spawn a second worker', async () => {
    await bottleneckAnalyzer.startProfiling({ intervalMs: 50, maxSamples: 3 });
    const firstWorker = bottleneckAnalyzer._worker;
    await bottleneckAnalyzer.startProfiling({ intervalMs: 50, maxSamples: 3 });
    expect(bottleneckAnalyzer._worker).toBe(firstWorker); // same instance
    await bottleneckAnalyzer.stopProfiling();
  });
});
