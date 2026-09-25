/**
 * #1115 — throughput must be requests per second in both load-test modules.
 */
import { describe, it, expect } from 'vitest';
import PerformanceBaseline from '../src/loadTesting/performanceBaseline.js';
import LoadTestRunner from '../src/loadTesting/loadTestRunner.js';
import { throughputRps } from '../src/loadTesting/throughput.js';

function makeResults(count, startTs, intervalMs, responseTime = 50) {
  return Array.from({ length: count }, (_, i) => ({
    responseTime,
    success: true,
    timestamp: startTs + i * intervalMs,
  }));
}

describe('throughput units (req/s)', () => {
  it('throughputRps converts a millisecond duration to requests per second', () => {
    expect(throughputRps(10, 2000)).toBe(5);
    expect(throughputRps(10, 0)).toBe(0);
    expect(throughputRps(0, 1000)).toBe(0);
  });

  it('LoadTestRunner and PerformanceBaseline agree on identical elapsed data', () => {
    const startTs = 1_700_000_000_000;
    const intervalMs = 100;
    const count = 20;
    const results = makeResults(count, startTs, intervalMs);

    const baseline = new PerformanceBaseline('unit-agreement');
    baseline.calculateFromResults(results);

    const runner = new LoadTestRunner();
    runner.results = results;
    runner.startTime = results[0].timestamp;
    runner.endTime = results[count - 1].timestamp;

    const runnerThroughput = runner.getResults().throughput;
    const expected = count / ((results[count - 1].timestamp - results[0].timestamp) / 1000);

    expect(baseline.metrics.throughput).toBeCloseTo(expected, 10);
    expect(runnerThroughput).toBeCloseTo(expected, 10);
    expect(runnerThroughput).toBeCloseTo(baseline.metrics.throughput, 10);
    // Guard against the old req/ms convention (~1000x smaller).
    expect(baseline.metrics.throughput).toBeGreaterThan(1);
  });
});
