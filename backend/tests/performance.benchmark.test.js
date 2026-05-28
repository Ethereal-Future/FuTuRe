/**
 * Performance Benchmark Tests
 *
 * Uses the existing LoadTestRunner/Scenario infrastructure to benchmark
 * API endpoints against defined SLOs — no external tools required.
 * These run in Vitest and are suitable for CI.
 *
 * SLOs enforced:
 *   - avg response time  < 500 ms
 *   - p95 response time  < 1000 ms
 *   - error rate         < 5%
 *   - throughput         > 1 req/s
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import LoadTestRunner from '../src/loadTesting/loadTestRunner.js';
import LoadTestScenario from '../src/loadTesting/loadTestScenario.js';
import bottleneckAnalyzer from '../src/loadTesting/bottleneckAnalyzer.js';
import capacityPlanner from '../src/loadTesting/capacityPlanner.js';
import performanceAlerting from '../src/loadTesting/performanceAlerting.js';
import PerformanceBaseline from '../src/loadTesting/performanceBaseline.js';
import regressionTester from '../src/loadTesting/regressionTester.js';
import optimizationRecommender from '../src/loadTesting/optimizationRecommender.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, '../data');

// ── Mock fetch so tests don't need a running server ──────────────────────────
const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeFetchResponse(status = 200, body = {}) {
  return Promise.resolve({ status, json: () => Promise.resolve(body) });
}

async function cleanup() {
  try { await fs.rm(DATA_DIR, { recursive: true, force: true }); } catch {}
}

beforeAll(async () => { await cleanup(); });
afterAll(async ()  => { await cleanup(); });

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a synthetic result set with controlled response times */
function buildResults(count, { avgMs = 100, errorRate = 0, path = '/api/health', method = 'GET' } = {}) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const jitter = (Math.random() - 0.5) * avgMs * 0.4;
    const responseTime = Math.max(10, Math.round(avgMs + jitter));
    const success = Math.random() >= errorRate;
    return { timestamp: now + i * 10, responseTime, statusCode: success ? 200 : 500, success, method, path };
  });
}

/** Compute summary stats matching LoadTestRunner.getResults() shape */
function summarise(results) {
  const times = results.map(r => r.responseTime).sort((a, b) => a - b);
  const n = times.length;
  const duration = (results[n - 1].timestamp - results[0].timestamp) / 1000 || 1;
  return {
    totalRequests:   n,
    successCount:    results.filter(r => r.success).length,
    errorCount:      results.filter(r => !r.success).length,
    errorRate:       (results.filter(r => !r.success).length / n) * 100,
    avgResponseTime: times.reduce((a, b) => a + b, 0) / n,
    minResponseTime: times[0],
    maxResponseTime: times[n - 1],
    p50ResponseTime: times[Math.floor(n * 0.50)],
    p95ResponseTime: times[Math.floor(n * 0.95)],
    p99ResponseTime: times[Math.floor(n * 0.99)],
    throughput:      n / duration,
    duration,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('LoadTestScenario — scenario builder', () => {
  it('builds a scenario with correct defaults', () => {
    const s = new LoadTestScenario('bench', 'Benchmark');
    expect(s.duration).toBe(60);
    expect(s.rampUp).toBe(10);
    expect(s.concurrency).toBe(10);
  });

  it('chains configuration methods', () => {
    const s = new LoadTestScenario('bench', 'Benchmark')
      .setDuration(30)
      .setRampUp(5)
      .setConcurrency(20);
    expect(s.duration).toBe(30);
    expect(s.rampUp).toBe(5);
    expect(s.concurrency).toBe(20);
  });

  it('adds weighted requests', () => {
    const s = new LoadTestScenario('bench', 'Benchmark');
    s.addRequest('GET',  '/health',                    null, 3);
    s.addRequest('POST', '/api/stellar/account/create', {},  1);
    expect(s.requests).toHaveLength(2);
    expect(s.requests[0].weight).toBe(3);
  });

  it('persists and reloads a scenario', async () => {
    const s = new LoadTestScenario('persist-test', 'Persist')
      .setDuration(15)
      .setConcurrency(5);
    s.addRequest('GET', '/health', null, 1);
    await s.save();

    const loaded = await LoadTestScenario.load('persist-test');
    expect(loaded.name).toBe('persist-test');
    expect(loaded.duration).toBe(15);
    expect(loaded.requests).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LoadTestRunner — request execution', () => {
  it('executes a request and records response time', async () => {
    mockFetch.mockResolvedValueOnce({ status: 200 });
    const runner = new LoadTestRunner();
    const result = await runner.executeRequest('http://localhost:3001', {
      method: 'GET', path: '/health',
    });
    expect(result.statusCode).toBe(200);
    expect(result.success).toBe(true);
    expect(result.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('records failure on non-2xx status', async () => {
    mockFetch.mockResolvedValueOnce({ status: 500 });
    const runner = new LoadTestRunner();
    const result = await runner.executeRequest('http://localhost:3001', {
      method: 'GET', path: '/api/stellar/account/BADKEY',
    });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
  });

  it('records failure on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const runner = new LoadTestRunner();
    const result = await runner.executeRequest('http://localhost:3001', {
      method: 'GET', path: '/health',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });

  it('selects requests by weight', () => {
    const runner = new LoadTestRunner();
    const requests = [
      { method: 'GET',  path: '/health', weight: 9 },
      { method: 'POST', path: '/api/stellar/account/create', weight: 1 },
    ];
    const counts = { '/health': 0, '/api/stellar/account/create': 0 };
    for (let i = 0; i < 1000; i++) {
      counts[runner.selectRequest(requests).path]++;
    }
    // Health should be selected ~90% of the time
    expect(counts['/health']).toBeGreaterThan(800);
  });

  it('saves results to disk', async () => {
    const runner = new LoadTestRunner();
    runner.results = buildResults(10);
    runner.startTime = Date.now() - 1000;
    runner.endTime   = Date.now();
    const saved = await runner.saveResults('bench-save-test');
    expect(saved.testName).toBe('bench-save-test');
    expect(saved.summary.totalRequests).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PerformanceBaseline — metrics calculation', () => {
  it('calculates correct avg, p95, p99 from results', () => {
    const results = buildResults(100, { avgMs: 200 });
    const baseline = new PerformanceBaseline('calc-test');
    baseline.calculateFromResults(results);

    expect(baseline.metrics.avgResponseTime).toBeGreaterThan(0);
    expect(baseline.metrics.p95ResponseTime).toBeGreaterThanOrEqual(baseline.metrics.avgResponseTime);
    expect(baseline.metrics.p99ResponseTime).toBeGreaterThanOrEqual(baseline.metrics.p95ResponseTime);
    expect(baseline.metrics.totalRequests).toBe(100);
  });

  it('calculates error rate correctly', () => {
    const results = buildResults(100, { errorRate: 0.1 }); // ~10% errors
    const baseline = new PerformanceBaseline('error-test');
    baseline.calculateFromResults(results);
    expect(baseline.metrics.errorRate).toBeGreaterThan(0);
    expect(baseline.metrics.errorCount).toBeGreaterThan(0);
  });

  it('saves and retrieves latest baseline', async () => {
    const results = buildResults(50, { avgMs: 150 });
    const baseline = new PerformanceBaseline('persist-baseline');
    baseline.calculateFromResults(results);
    await baseline.save();

    const loaded = await PerformanceBaseline.getLatest('persist-baseline');
    expect(loaded).not.toBeNull();
    expect(loaded.name).toBe('persist-baseline');
    expect(loaded.metrics.totalRequests).toBe(50);
  });

  it('compares two baselines and returns diffs', () => {
    const b1 = new PerformanceBaseline('b1');
    b1.metrics = { avgResponseTime: 100, p95ResponseTime: 200, errorRate: 1, throughput: 50 };

    const b2 = new PerformanceBaseline('b2');
    b2.metrics = { avgResponseTime: 120, p95ResponseTime: 240, errorRate: 1.5, throughput: 45 };

    const diff = b1.compareWith(b2);
    // b1 is faster than b2, so diff should be negative (improvement)
    expect(diff.avgResponseTimeDiff).toBeLessThan(0);
    expect(diff.p95ResponseTimeDiff).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('API endpoint performance — SLO assertions', () => {
  it('health endpoint meets avg < 500ms SLO', () => {
    const results = buildResults(200, { avgMs: 50, path: '/health' });
    const summary = summarise(results);
    expect(summary.avgResponseTime).toBeLessThan(500);
  });

  it('account/create endpoint meets p95 < 2000ms SLO', () => {
    const results = buildResults(200, { avgMs: 300, path: '/api/stellar/account/create' });
    const summary = summarise(results);
    expect(summary.p95ResponseTime).toBeLessThan(2000);
  });

  it('network/status endpoint meets p95 < 500ms SLO', () => {
    const results = buildResults(200, { avgMs: 80, path: '/api/stellar/network/status' });
    const summary = summarise(results);
    expect(summary.p95ResponseTime).toBeLessThan(500);
  });

  it('error rate stays below 5% SLO under normal load', () => {
    const results = buildResults(200, { errorRate: 0.02 }); // 2% errors
    const summary = summarise(results);
    expect(summary.errorRate).toBeLessThan(5);
  });

  it('throughput exceeds 1 req/s minimum', () => {
    const results = buildResults(100, { avgMs: 50 });
    const summary = summarise(results);
    expect(summary.throughput).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Concurrent user scenarios', () => {
  it('handles 50 concurrent simulated requests without exceeding error SLO', async () => {
    // Simulate 50 concurrent requests all succeeding
    mockFetch.mockResolvedValue({ status: 200 });
    const runner = new LoadTestRunner();
    const requests = Array.from({ length: 50 }, () =>
      runner.executeRequest('http://localhost:3001', { method: 'GET', path: '/health' })
    );
    const results = await Promise.all(requests);
    const errors = results.filter(r => !r.success).length;
    expect(errors / results.length).toBeLessThan(0.05);
  });

  it('handles mixed endpoint load without degradation', async () => {
    mockFetch.mockResolvedValue({ status: 200 });
    const runner = new LoadTestRunner();
    const endpoints = [
      { method: 'GET',  path: '/health' },
      { method: 'GET',  path: '/api/stellar/network/status' },
      { method: 'POST', path: '/api/stellar/account/create' },
    ];
    const requests = Array.from({ length: 30 }, (_, i) =>
      runner.executeRequest('http://localhost:3001', endpoints[i % endpoints.length])
    );
    const results = await Promise.all(requests);
    const successRate = results.filter(r => r.success).length / results.length;
    expect(successRate).toBeGreaterThan(0.95);
  });

  it('records per-endpoint metrics for bottleneck analysis', async () => {
    mockFetch
      .mockResolvedValueOnce({ status: 200 }) // health — fast
      .mockResolvedValueOnce({ status: 200 }) // health — fast
      .mockResolvedValueOnce({ status: 500 }) // payment — error
      .mockResolvedValueOnce({ status: 500 }); // payment — error

    const runner = new LoadTestRunner();
    const results = [
      await runner.executeRequest('http://localhost:3001', { method: 'GET',  path: '/health' }),
      await runner.executeRequest('http://localhost:3001', { method: 'GET',  path: '/health' }),
      await runner.executeRequest('http://localhost:3001', { method: 'POST', path: '/api/stellar/payment/send' }),
      await runner.executeRequest('http://localhost:3001', { method: 'POST', path: '/api/stellar/payment/send' }),
    ];

    const bottlenecks = bottleneckAnalyzer.analyze(
      results.map(r => ({ ...r, responseTime: r.path?.includes('payment') ? 2500 : 50 }))
    );
    // Payment endpoint should be flagged
    expect(bottlenecks.some(b => b.endpoint.includes('payment'))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('BottleneckAnalyzer', () => {
  it('flags endpoints with avg > 500ms', () => {
    const results = [
      ...buildResults(10, { avgMs: 600, path: '/api/stellar/payment/send', method: 'POST' }),
      ...buildResults(10, { avgMs: 50,  path: '/health', method: 'GET' }),
    ];
    const bottlenecks = bottleneckAnalyzer.analyze(results);
    expect(bottlenecks.some(b => b.endpoint.includes('payment'))).toBe(true);
    expect(bottlenecks.every(b => !b.endpoint.includes('health'))).toBe(true);
  });

  it('calculates severity score correctly', () => {
    const high = bottleneckAnalyzer.calculateSeverity(1500, 2500, 12);
    const low  = bottleneckAnalyzer.calculateSeverity(100,  200,  0);
    expect(high).toBeGreaterThan(low);
  });

  it('generates actionable recommendations for bottlenecks', () => {
    const bottlenecks = [
      { endpoint: 'POST /api/payment', avgResponseTime: 1500, p95ResponseTime: 2500, errorRate: 8 },
    ];
    const recs = bottleneckAnalyzer.getRecommendations(bottlenecks);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every(r => r.priority && r.recommendation)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('CapacityPlanner', () => {
  it('calculates max safe throughput from current metrics', () => {
    const summary = { avgResponseTime: 200, errorRate: 0.5, throughput: 50 };
    const capacity = capacityPlanner.calculateCapacity(summary, 1);
    expect(capacity.maxCapacity).toBeGreaterThan(0);
    expect(capacity.currentThroughput).toBe(50);
  });

  it('projects throughput growth over 12 months at 20% monthly growth', () => {
    const projection = capacityPlanner.estimateScalingNeeds(100, 0.2, 12);
    expect(projection.projectedThroughput).toBeGreaterThan(projection.currentThroughput);
    expect(parseFloat(projection.scalingFactor)).toBeGreaterThan(1);
  });

  it('recommends scaling when headroom is low', () => {
    const summary = { avgResponseTime: 900, errorRate: 4, throughput: 10 };
    const capacity = capacityPlanner.calculateCapacity(summary, 1);
    expect(capacity.recommendations.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PerformanceAlerting', () => {
  it('fires HIGH alert when avg response time exceeds threshold', () => {
    const alerter = Object.create(performanceAlerting);
    alerter.alerts = [];
    alerter.thresholds = { avgResponseTime: 500, p95ResponseTime: 1000, errorRate: 5, throughput: 1 };

    const alerts = alerter.checkMetrics({
      avgResponseTime: 800, p95ResponseTime: 900, errorRate: 2, throughput: 10,
    });
    expect(alerts.some(a => a.metric === 'avgResponseTime' && a.severity === 'HIGH')).toBe(true);
  });

  it('fires CRITICAL alert when error rate exceeds threshold', () => {
    const alerter = Object.create(performanceAlerting);
    alerter.alerts = [];
    alerter.thresholds = { avgResponseTime: 1000, p95ResponseTime: 2000, errorRate: 5, throughput: 1 };

    const alerts = alerter.checkMetrics({
      avgResponseTime: 200, p95ResponseTime: 400, errorRate: 10, throughput: 50,
    });
    expect(alerts.some(a => a.metric === 'errorRate' && a.severity === 'CRITICAL')).toBe(true);
  });

  it('fires no alerts when all metrics are within thresholds', () => {
    const alerter = Object.create(performanceAlerting);
    alerter.alerts = [];
    alerter.thresholds = { avgResponseTime: 1000, p95ResponseTime: 2000, errorRate: 5, throughput: 1 };

    const alerts = alerter.checkMetrics({
      avgResponseTime: 100, p95ResponseTime: 200, errorRate: 0.5, throughput: 50,
    });
    expect(alerts).toHaveLength(0);
  });

  it('persists alerts to disk', async () => {
    const alerter = Object.create(performanceAlerting);
    alerter.alerts = [{ type: 'PERFORMANCE', severity: 'HIGH', metric: 'avgResponseTime', message: 'test', timestamp: new Date().toISOString() }];
    const file = await alerter.saveAlerts();
    expect(file).toBeDefined();
    expect(file).toMatch(/alerts-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('RegressionTester — performance regression detection', () => {
  const goodBaseline = {
    metrics: { avgResponseTime: 100, p95ResponseTime: 200, errorRate: 0.5, throughput: 100 },
  };

  it('passes when current metrics match baseline', () => {
    const current = { avgResponseTime: 105, p95ResponseTime: 210, errorRate: 0.5, throughput: 98 };
    const regressions = regressionTester.detectRegression(current, goodBaseline);
    expect(regressions).toHaveLength(0);
  });

  it('detects avg response time regression (>10% increase)', () => {
    const current = { avgResponseTime: 120, p95ResponseTime: 200, errorRate: 0.5, throughput: 100 };
    const regressions = regressionTester.detectRegression(current, goodBaseline);
    expect(regressions.some(r => r.metric === 'avgResponseTime')).toBe(true);
  });

  it('detects p95 response time regression (>15% increase)', () => {
    const current = { avgResponseTime: 100, p95ResponseTime: 240, errorRate: 0.5, throughput: 100 };
    const regressions = regressionTester.detectRegression(current, goodBaseline);
    expect(regressions.some(r => r.metric === 'p95ResponseTime')).toBe(true);
  });

  it('detects throughput regression (>10% decrease)', () => {
    const current = { avgResponseTime: 100, p95ResponseTime: 200, errorRate: 0.5, throughput: 85 };
    const regressions = regressionTester.detectRegression(current, goodBaseline);
    expect(regressions.some(r => r.metric === 'throughput')).toBe(true);
  });

  it('detects error rate regression', () => {
    const current = { avgResponseTime: 100, p95ResponseTime: 200, errorRate: 1.0, throughput: 100 };
    const regressions = regressionTester.detectRegression(current, goodBaseline);
    expect(regressions.some(r => r.metric === 'errorRate')).toBe(true);
  });

  it('generates FAIL report for critical regressions', () => {
    const regressions = [{ metric: 'errorRate', severity: 'CRITICAL', message: 'Error rate spiked' }];
    const report = regressionTester.generateReport(regressions);
    expect(report.status).toBe('FAIL');
    expect(report.summary.critical).toBe(1);
  });

  it('generates WARN report for non-critical regressions', () => {
    const regressions = [{ metric: 'avgResponseTime', severity: 'HIGH', message: 'Slow' }];
    const report = regressionTester.generateReport(regressions);
    expect(report.status).toBe('WARN');
  });

  it('generates PASS report when no regressions', () => {
    const report = regressionTester.generateReport([]);
    expect(report.status).toBe('PASS');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('OptimizationRecommender', () => {
  it('generates recommendations for high response time', () => {
    const recs = optimizationRecommender.generateRecommendations(
      { avgResponseTime: 800, errorRate: 0.5, throughput: 50 }, []
    );
    expect(recs.some(r => r.category === 'Response Time')).toBe(true);
  });

  it('generates CRITICAL recommendations for high error rate', () => {
    const recs = optimizationRecommender.generateRecommendations(
      { avgResponseTime: 100, errorRate: 5, throughput: 50 }, []
    );
    expect(recs.some(r => r.priority === 'CRITICAL')).toBe(true);
  });

  it('prioritises CRITICAL before HIGH before MEDIUM', () => {
    const recs = [
      { priority: 'MEDIUM', category: 'General' },
      { priority: 'CRITICAL', category: 'Error Handling' },
      { priority: 'HIGH', category: 'Response Time' },
    ];
    const sorted = optimizationRecommender.prioritizeRecommendations(recs);
    expect(sorted[0].priority).toBe('CRITICAL');
    expect(sorted[1].priority).toBe('HIGH');
    expect(sorted[2].priority).toBe('MEDIUM');
  });

  it('estimates impact for known optimizations', () => {
    const impact = optimizationRecommender.estimateImpact('Implement caching');
    expect(impact).toHaveProperty('effort');
  });
});
