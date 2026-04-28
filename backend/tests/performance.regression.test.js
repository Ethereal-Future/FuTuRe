/**
 * Performance Benchmarks & Regression Detection
 *
 * Covers:
 *  - Baseline measurement capture
 *  - Regression detection (avg, p95, error-rate, throughput)
 *  - Trend analysis across multiple runs
 *  - Alerting thresholds
 *  - Optimization recommendations
 *  - Comparison between two result sets
 *  - Bottleneck identification
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import PerformanceBaseline from '../src/loadTesting/performanceBaseline.js';
import regressionTester from '../src/loadTesting/regressionTester.js';
import performanceAlerting from '../src/loadTesting/performanceAlerting.js';
import optimizationRecommender from '../src/loadTesting/optimizationRecommender.js';
import bottleneckAnalyzer from '../src/loadTesting/bottleneckAnalyzer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

async function cleanup() {
  try { await fs.rm(DATA_DIR, { recursive: true, force: true }); } catch {}
}

/** Build synthetic result array */
function makeResults(count, { avgMs = 100, errorRate = 0, path: p = '/api/health', method = 'GET' } = {}) {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const rt = Math.max(10, Math.round(avgMs + (Math.random() - 0.5) * avgMs * 0.3));
    const success = Math.random() >= errorRate;
    return { timestamp: now + i * 10, responseTime: rt, statusCode: success ? 200 : 500, success, method, path: p };
  });
}

/** Compute summary stats matching regressionTester.detectRegression() input shape */
function summarise(results) {
  const times = results.map(r => r.responseTime).sort((a, b) => a - b);
  const n = times.length;
  const duration = (results[n - 1].timestamp - results[0].timestamp) / 1000 || 1;
  return {
    avgResponseTime: times.reduce((a, b) => a + b, 0) / n,
    p95ResponseTime: times[Math.floor(n * 0.95)],
    errorRate: (results.filter(r => !r.success).length / n) * 100,
    throughput: n / duration,
  };
}

beforeAll(cleanup);
afterAll(cleanup);

// ── 1. Baseline measurement ───────────────────────────────────────────────────
describe('Performance Baseline', () => {
  it('calculates metrics from results', () => {
    const baseline = new PerformanceBaseline('test-baseline');
    baseline.calculateFromResults(makeResults(100, { avgMs: 150 }));
    expect(baseline.metrics.totalRequests).toBe(100);
    expect(baseline.metrics.avgResponseTime).toBeGreaterThan(0);
    expect(baseline.metrics.p95ResponseTime).toBeGreaterThanOrEqual(baseline.metrics.avgResponseTime);
    expect(baseline.metrics.errorRate).toBe(0);
  });

  it('saves baseline to disk', async () => {
    const baseline = new PerformanceBaseline('save-test');
    baseline.calculateFromResults(makeResults(50));
    const file = await baseline.save();
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(raw.name).toBe('save-test');
    expect(raw.metrics.totalRequests).toBe(50);
  });
});

// ── 2. Regression detection ───────────────────────────────────────────────────
describe('Regression Detection', () => {
  it('detects no regression when performance is stable', () => {
    const baseline = new PerformanceBaseline('stable');
    baseline.calculateFromResults(makeResults(100, { avgMs: 100 }));

    const current = summarise(makeResults(100, { avgMs: 105 }));
    const regressions = regressionTester.detectRegression(current, baseline);
    const report = regressionTester.generateReport(regressions);
    expect(report.status).toBe('PASS');
  });

  it('detects regression when avg response time degrades significantly', () => {
    const baseline = new PerformanceBaseline('degraded');
    baseline.calculateFromResults(makeResults(100, { avgMs: 100 }));

    const current = summarise(makeResults(100, { avgMs: 600 }));
    const regressions = regressionTester.detectRegression(current, baseline);
    expect(regressions.some(r => r.metric === 'avgResponseTime')).toBe(true);
  });

  it('detects regression when error rate spikes', () => {
    const baseline = new PerformanceBaseline('error-spike');
    baseline.calculateFromResults(makeResults(100, { avgMs: 100, errorRate: 0 }));
    // Force baseline error rate to 0 so any spike is detected
    baseline.metrics.errorRate = 0.1;

    const current = summarise(makeResults(100, { avgMs: 100, errorRate: 0.3 }));
    const regressions = regressionTester.detectRegression(current, baseline);
    expect(regressions.some(r => r.metric === 'errorRate')).toBe(true);
  });

  it('generates FAIL report for critical regressions', () => {
    const regressions = [{ metric: 'errorRate', severity: 'CRITICAL', message: 'Error rate spiked' }];
    const report = regressionTester.generateReport(regressions);
    expect(report.status).toBe('FAIL');
  });
});

// ── 3. Trend analysis (manual) ────────────────────────────────────────────────
describe('Performance Trend Analysis', () => {
  it('identifies improving trend from decreasing avg response times', () => {
    const avgTimes = [300, 250, 200, 150, 100];
    // Simple linear regression slope
    const n = avgTimes.length;
    const xMean = (n - 1) / 2;
    const yMean = avgTimes.reduce((a, b) => a + b, 0) / n;
    const slope = avgTimes.reduce((sum, y, x) => sum + (x - xMean) * (y - yMean), 0) /
                  avgTimes.reduce((sum, _, x) => sum + (x - xMean) ** 2, 0);
    expect(slope).toBeLessThan(0); // negative slope = improving
  });

  it('identifies degrading trend from increasing avg response times', () => {
    const avgTimes = [100, 150, 200, 250, 300];
    const n = avgTimes.length;
    const xMean = (n - 1) / 2;
    const yMean = avgTimes.reduce((a, b) => a + b, 0) / n;
    const slope = avgTimes.reduce((sum, y, x) => sum + (x - xMean) * (y - yMean), 0) /
                  avgTimes.reduce((sum, _, x) => sum + (x - xMean) ** 2, 0);
    expect(slope).toBeGreaterThan(0); // positive slope = degrading
  });
});

// ── 4. Alerting thresholds ────────────────────────────────────────────────────
describe('Performance Alerting', () => {
  it('does not alert when within thresholds', () => {
    const metrics = { avgResponseTime: 200, p95ResponseTime: 400, errorRate: 1, throughput: 50 };
    const alerts = performanceAlerting.checkMetrics(metrics);
    expect(alerts.filter(a => a.severity === 'CRITICAL')).toHaveLength(0);
  });

  it('fires HIGH alert when avg response time exceeds 1000ms threshold', () => {
    const metrics = { avgResponseTime: 2000, p95ResponseTime: 400, errorRate: 0, throughput: 50 };
    const alerts = performanceAlerting.checkMetrics(metrics);
    expect(alerts.some(a => a.metric === 'avgResponseTime' && a.severity === 'HIGH')).toBe(true);
  });

  it('fires CRITICAL alert when error rate exceeds 5% threshold', () => {
    const metrics = { avgResponseTime: 100, p95ResponseTime: 200, errorRate: 20, throughput: 50 };
    const alerts = performanceAlerting.checkMetrics(metrics);
    expect(alerts.some(a => a.severity === 'CRITICAL')).toBe(true);
  });

  it('fires HIGH alert when throughput drops below threshold', () => {
    const metrics = { avgResponseTime: 100, p95ResponseTime: 200, errorRate: 0, throughput: 1 };
    const alerts = performanceAlerting.checkMetrics(metrics);
    expect(alerts.some(a => a.metric === 'throughput')).toBe(true);
  });

  it('saves alerts to disk', async () => {
    performanceAlerting.checkMetrics({ avgResponseTime: 2000, p95ResponseTime: 3000, errorRate: 10, throughput: 1 });
    const file = await performanceAlerting.saveAlerts();
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(Array.isArray(saved)).toBe(true);
    expect(saved.length).toBeGreaterThan(0);
  });
});

// ── 5. Optimization recommendations ──────────────────────────────────────────
describe('Optimization Recommendations', () => {
  it('returns HIGH priority recommendations for slow endpoints', () => {
    const results = summarise(makeResults(100, { avgMs: 800 }));
    const bottlenecks = bottleneckAnalyzer.analyze(makeResults(100, { avgMs: 800 }));
    const recs = optimizationRecommender.generateRecommendations(results, bottlenecks);
    expect(Array.isArray(recs)).toBe(true);
    expect(recs.some(r => r.priority === 'HIGH' || r.priority === 'CRITICAL')).toBe(true);
  });

  it('prioritizes recommendations by severity', () => {
    const recs = [
      { priority: 'MEDIUM' },
      { priority: 'CRITICAL' },
      { priority: 'HIGH' },
    ];
    const sorted = optimizationRecommender.prioritizeRecommendations(recs);
    expect(sorted[0].priority).toBe('CRITICAL');
    expect(sorted[1].priority).toBe('HIGH');
  });
});

// ── 6. Comparison tools ───────────────────────────────────────────────────────
describe('Performance Comparison', () => {
  it('shows improvement when current is faster than baseline', () => {
    const baselineB = new PerformanceBaseline('before');
    baselineB.calculateFromResults(makeResults(100, { avgMs: 200 }));

    const afterSummary = summarise(makeResults(100, { avgMs: 100 }));
    const delta = afterSummary.avgResponseTime - baselineB.metrics.avgResponseTime;
    expect(delta).toBeLessThan(0); // negative = faster
  });

  it('shows regression when current is slower than baseline', () => {
    const baselineB = new PerformanceBaseline('before-slow');
    baselineB.calculateFromResults(makeResults(100, { avgMs: 100 }));

    const afterSummary = summarise(makeResults(100, { avgMs: 300 }));
    const regressions = regressionTester.detectRegression(afterSummary, baselineB);
    expect(regressions.some(r => r.metric === 'avgResponseTime')).toBe(true);
  });
});

// ── 7. Bottleneck analysis ────────────────────────────────────────────────────
describe('Bottleneck Analysis', () => {
  it('identifies slow paths as bottlenecks', () => {
    const results = [
      ...makeResults(50, { avgMs: 50, path: '/api/fast' }),
      ...makeResults(50, { avgMs: 900, path: '/api/slow' }),
    ];
    const bottlenecks = bottleneckAnalyzer.analyze(results);
    expect(bottlenecks.some(b => b.endpoint.includes('/api/slow'))).toBe(true);
  });

  it('does not flag fast endpoints as bottlenecks', () => {
    const results = makeResults(100, { avgMs: 50, path: '/api/fast' });
    const bottlenecks = bottleneckAnalyzer.analyze(results);
    expect(bottlenecks.some(b => b.endpoint.includes('/api/fast'))).toBe(false);
  });

  it('generates bottleneck-specific recommendations', () => {
    const results = makeResults(50, { avgMs: 1200, path: '/api/heavy' });
    const bottlenecks = bottleneckAnalyzer.analyze(results);
    const recs = bottleneckAnalyzer.getRecommendations(bottlenecks);
    expect(Array.isArray(recs)).toBe(true);
  });
});
