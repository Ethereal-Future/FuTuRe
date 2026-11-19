/**
 * #1115 — throughput must be requests per second in both load-test modules.
 */
import { describe, it, expect } from 'vitest';
import PerformanceBaseline from '../src/loadTesting/performanceBaseline.js';
import LoadTestRunner from '../src/loadTesting/loadTestRunner.js';
import { throughputRps } from '../src/loadTesting/throughput.js';

/**
 * Build a fake request function that records the number of in-flight requests
 * and simulates a fixed server response time. Used to verify bounded
 * concurrency and rate pacing without touching real sockets.
 */
function makeFakeRequest({ responseTimeMs = 20, onStart } = {}) {
  let inFlight = 0;
  let maxInFlight = 0;
  const fn = async () => {
    inFlight += 1;
    if (inFlight > maxInFlight) maxInFlight = inFlight;
    if (onStart) onStart(inFlight);
    await new Promise((resolve) => setTimeout(resolve, responseTimeMs));
    inFlight -= 1;
    return { responseTime: responseTimeMs, success: true, timestamp: Date.now() };
  };
  return {
    fn,
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

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

describe('bounded concurrency and rate pacing', () => {
  it('never exceeds the configured concurrency limit', async () => {
    const concurrency = 8;
    const total = 200;
    const fake = makeFakeRequest({ responseTimeMs: 5 });

    const runner = new LoadTestRunner();
    const results = await runner.runBounded({
      total,
      concurrency,
      requestFn: fake.fn,
    });

    expect(results).toHaveLength(total);
    expect(fake.maxInFlight).toBeLessThanOrEqual(concurrency);
    expect(fake.maxInFlight).toBeGreaterThan(1);
  });

  it('paces requests to the configured requestsPerSecond within tolerance', async () => {
    const requestsPerSecond = 100;
    const total = 50;
    const fake = makeFakeRequest({ responseTimeMs: 1 });

    const runner = new LoadTestRunner();
    const start = Date.now();
    const results = await runner.runBounded({
      total,
      concurrency: 10,
      requestsPerSecond,
      requestFn: fake.fn,
    });
    const elapsedMs = Date.now() - start;

    expect(results).toHaveLength(total);
    const observedRps = throughputRps(total, elapsedMs);
    // Allow generous tolerance for CI scheduling jitter.
    expect(observedRps).toBeGreaterThan(requestsPerSecond * 0.5);
    expect(observedRps).toBeLessThan(requestsPerSecond * 2);
  });

  it('throughput scales with concurrency but never exceeds concurrency / avgResponseTime', async () => {
    const responseTimeMs = 20;
    const concurrency = 16;
    const total = 160;
    const fake = makeFakeRequest({ responseTimeMs });

    const runner = new LoadTestRunner();
    const start = Date.now();
    const results = await runner.runBounded({
      total,
      concurrency,
      requestFn: fake.fn,
    });
    const elapsedMs = Date.now() - start;

    expect(results).toHaveLength(total);
    const observedRps = throughputRps(total, elapsedMs);
    const theoreticalMax = concurrency / (responseTimeMs / 1000);

    // No artificial client-side queuing inflation: observed throughput must
    // stay at or below the theoretical bound implied by concurrency and
    // average response time.
    expect(observedRps).toBeLessThanOrEqual(theoreticalMax * 1.1);
    expect(fake.maxInFlight).toBeLessThanOrEqual(concurrency);
  });

  it('handles 10,000 virtual requests without socket exhaustion', async () => {
    const concurrency = 64;
    const total = 10_000;
    const fake = makeFakeRequest({ responseTimeMs: 0 });

    const runner = new LoadTestRunner();
    const results = await runner.runBounded({
      total,
      concurrency,
      requestFn: fake.fn,
    });

    expect(results).toHaveLength(total);
    expect(fake.maxInFlight).toBeLessThanOrEqual(concurrency);
  });
});
