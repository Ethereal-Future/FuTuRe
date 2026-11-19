/**
 * Tests for the statistical significance layer added to RegressionTester
 * in #1415.
 *
 * Coverage:
 *  - descriptiveStats / welchT / welchDf / criticalT / isSignificant helpers
 *  - detectRegression: noisy small % change downgraded to INFO
 *  - detectRegression: large real regression keeps HIGH / CRITICAL severity
 *  - detectRegression: insufficient samples falls back to percentage-only
 *  - generateReport: noise-only regressions produce PASS
 *  - generateReport: real regressions produce FAIL
 *  - backward-compat: detectRegression without sampleStats arrays
 *  - recordSampleStats: attaches descriptive stats to a baseline
 */
import { describe, it, expect, beforeEach } from 'vitest';
import regressionTester, {
  descriptiveStats,
  welchT,
  welchDf,
  criticalT,
  isSignificant,
} from '../src/loadTesting/regressionTester.js';
import PerformanceBaseline from '../src/loadTesting/performanceBaseline.js';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a minimal baseline object (no DB, just plain object) */
function makeFakeBaseline(metricOverrides = {}, sampleStatsOverrides = {}) {
  return {
    executionModel: 'concurrent',
    schemaVersion: 2,
    metrics: {
      avgResponseTime: 100,
      p95ResponseTime: 200,
      errorRate: 1,
      throughput: 500,
      ...metricOverrides,
    },
    sampleStats: {
      responseTimes: { mean: 100, variance: 25, stdDev: 5, n: 500 },
      ...sampleStatsOverrides,
    },
  };
}

// N random values drawn from a normal-ish distribution centred at `mu`
// with spread `sigma`.
function normalish(n, mu, sigma) {
  return Array.from({ length: n }, () => {
    // Box-Muller-lite (deterministic via index is fine for tests)
    const u = Math.random();
    const v = Math.random();
    return mu + sigma * Math.sqrt(-2 * Math.log(u + 1e-10)) * Math.cos(2 * Math.PI * v);
  });
}

// ─── descriptiveStats ───────────────────────────────────────────────────────
describe('descriptiveStats', () => {
  it('returns zeroes for empty array', () => {
    expect(descriptiveStats([])).toEqual({ mean: 0, variance: 0, stdDev: 0, n: 0 });
  });

  it('computes correct mean for [1, 2, 3, 4, 5]', () => {
    const s = descriptiveStats([1, 2, 3, 4, 5]);
    expect(s.mean).toBe(3);
    expect(s.n).toBe(5);
  });

  it('uses Bessel-corrected (sample) variance', () => {
    // Population variance of [2,4,4,4,5,5,7,9] = 4.0
    // Sample variance = 4.571... (÷ n-1)
    const s = descriptiveStats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBeCloseTo(5, 5);
    expect(s.variance).toBeCloseTo(4.571, 2);
    expect(s.stdDev).toBeCloseTo(Math.sqrt(4.571), 2);
  });

  it('returns zero variance for a single element', () => {
    const s = descriptiveStats([42]);
    expect(s.mean).toBe(42);
    expect(s.variance).toBe(0);
    expect(s.n).toBe(1);
  });
});

// ─── criticalT ──────────────────────────────────────────────────────────────
describe('criticalT', () => {
  it('returns large value for df=1 (most conservative)', () => {
    expect(criticalT(1)).toBe(12.706);
  });

  it('returns 2.228 for df=10', () => {
    expect(criticalT(10)).toBe(2.228);
  });

  it('returns ~1.960 for large df', () => {
    expect(criticalT(Infinity)).toBe(1.960);
    expect(criticalT(200)).toBe(1.960);
  });
});

// ─── welchT + isSignificant ──────────────────────────────────────────────────
describe('welchT and isSignificant', () => {
  it('returns 0 for identical distributions', () => {
    const a = { mean: 100, variance: 25, n: 50 };
    expect(welchT(a, a)).toBe(0);
  });

  it('returns large t for clearly different means', () => {
    const a = { mean: 500, variance: 25, n: 100 };
    const b = { mean: 100, variance: 25, n: 100 };
    const t = welchT(a, b);
    expect(t).toBeGreaterThan(100);
  });

  it('isSignificant = true for obviously different distributions', () => {
    const curr = { mean: 500, variance: 25, n: 100 };
    const base = { mean: 100, variance: 25, n: 100 };
    const t = welchT(curr, base);
    expect(isSignificant(curr, base, t)).toBe(true);
  });

  it('isSignificant = false for high-variance distributions with tiny mean diff', () => {
    // tiny mean diff, huge variance → t will be very small
    const curr = { mean: 2.2, variance: 500, n: 30 };
    const base = { mean: 2.0, variance: 400, n: 30 };
    const t = welchT(curr, base);
    expect(isSignificant(curr, base, t)).toBe(false);
  });
});

// ─── detectRegression ───────────────────────────────────────────────────────
describe('RegressionTester.detectRegression', () => {
  beforeEach(() => {
    // Reset to defaults before each test
    regressionTester.thresholds = {
      avgResponseTime: 1.1,
      p95ResponseTime: 1.15,
      errorRate: 1.05,
      throughput: 0.9,
    };
    regressionTester.requireSignificance = true;
  });

  it('returns CRITICAL when execution model is serial (incompatible)', () => {
    const baseline = { executionModel: 'serial', metrics: {} };
    const regressions = regressionTester.detectRegression({}, baseline);
    expect(regressions).toHaveLength(1);
    expect(regressions[0].metric).toBe('executionModel');
    expect(regressions[0].severity).toBe('CRITICAL');
  });

  it('returns no regressions when current matches baseline', () => {
    const baseline = makeFakeBaseline();
    const current = {
      avgResponseTime: 100,
      p95ResponseTime: 200,
      errorRate: 1,
      throughput: 500,
    };
    expect(regressionTester.detectRegression(current, baseline)).toHaveLength(0);
  });

  it('downgrades to INFO when % threshold exceeded but not statistically significant', () => {
    // 10% increase in avgResponseTime (exceeds 1.1x threshold) but the
    // current samples are so noisy that the t-test rejects significance.
    const baseline = makeFakeBaseline(
      { avgResponseTime: 100 },
      { responseTimes: { mean: 100, variance: 1, stdDev: 1, n: 500 } },
    );
    const current = {
      avgResponseTime: 111, // 11% above — exceeds threshold
      p95ResponseTime: 200,
      errorRate: 1,
      throughput: 500,
      // Enormous variance → not significant
      responseTimes: Array.from({ length: 50 }, (_, i) => 111 + (i % 2 === 0 ? 200 : -200)),
    };
    const regressions = regressionTester.detectRegression(current, baseline);
    const reg = regressions.find((r) => r.metric === 'avgResponseTime');
    expect(reg).toBeDefined();
    expect(reg.severity).toBe('INFO');
    expect(reg.significant).toBe(false);
  });

  it('keeps HIGH severity when regression is statistically significant', () => {
    const baseline = makeFakeBaseline(
      { avgResponseTime: 100 },
      { responseTimes: { mean: 100, variance: 1, stdDev: 1, n: 500 } },
    );
    const current = {
      avgResponseTime: 500,
      p95ResponseTime: 200,
      errorRate: 1,
      throughput: 500,
      // Tight cluster around 500 → clearly different from 100
      responseTimes: Array.from({ length: 100 }, () => 500 + Math.random() * 2),
    };
    const regressions = regressionTester.detectRegression(current, baseline);
    const reg = regressions.find((r) => r.metric === 'avgResponseTime');
    expect(reg).toBeDefined();
    expect(reg.severity).toBe('HIGH');
    expect(reg.significant).toBe(true);
  });

  it('falls back to percentage-only with insufficientSamples when n < 10', () => {
    const baseline = makeFakeBaseline(
      { avgResponseTime: 100 },
      { responseTimes: { mean: 100, variance: 1, stdDev: 1, n: 500 } },
    );
    const current = {
      avgResponseTime: 200, // 100% increase — clearly a regression
      p95ResponseTime: 200,
      errorRate: 1,
      throughput: 500,
      // Too few samples to do a t-test
      responseTimes: [190, 200, 210],
    };
    const regressions = regressionTester.detectRegression(current, baseline);
    const reg = regressions.find((r) => r.metric === 'avgResponseTime');
    expect(reg).toBeDefined();
    expect(reg.insufficientSamples).toBe(true);
    // Should still report as HIGH (not INFO) when samples are too small to judge
    expect(reg.severity).toBe('HIGH');
  });

  it('detects throughput decrease regression', () => {
    const baseline = makeFakeBaseline({ throughput: 1000 });
    const current = {
      avgResponseTime: 100,
      p95ResponseTime: 200,
      errorRate: 1,
      throughput: 800, // 20% decrease — exceeds 0.9 threshold
    };
    const regressions = regressionTester.detectRegression(current, baseline);
    expect(regressions.find((r) => r.metric === 'throughput')).toBeDefined();
  });

  it('backward-compat: works without sampleStats (no statistical gating)', () => {
    // Baseline has no sampleStats → fall back to percentage-only
    const baseline = {
      executionModel: 'concurrent',
      schemaVersion: 2,
      metrics: { avgResponseTime: 100, p95ResponseTime: 200, errorRate: 1, throughput: 500 },
      // no sampleStats
    };
    const current = { avgResponseTime: 200, p95ResponseTime: 200, errorRate: 1, throughput: 500 };
    const regressions = regressionTester.detectRegression(current, baseline);
    const reg = regressions.find((r) => r.metric === 'avgResponseTime');
    expect(reg).toBeDefined();
    // Without sampleStats the system can't gate, significant defaults to true
    expect(reg.significant).toBe(true);
  });
});

// ─── generateReport ──────────────────────────────────────────────────────────
describe('RegressionTester.generateReport', () => {
  it('returns PASS with no regressions', () => {
    expect(regressionTester.generateReport([])).toMatchObject({ status: 'PASS' });
  });

  it('returns PASS when all regressions are INFO (noise)', () => {
    const noiseOnly = [{ severity: 'INFO', metric: 'avgResponseTime', significant: false }];
    expect(regressionTester.generateReport(noiseOnly)).toMatchObject({ status: 'PASS' });
  });

  it('returns FAIL when there is a CRITICAL regression', () => {
    const regressions = [{ severity: 'CRITICAL', metric: 'errorRate', significant: true }];
    expect(regressionTester.generateReport(regressions)).toMatchObject({ status: 'FAIL' });
  });

  it('returns FAIL for HIGH regression', () => {
    const regressions = [{ severity: 'HIGH', metric: 'avgResponseTime', significant: true }];
    expect(regressionTester.generateReport(regressions)).toMatchObject({ status: 'FAIL' });
  });

  it('returns WARN for MEDIUM-only regression', () => {
    const regressions = [{ severity: 'MEDIUM', metric: 'p95ResponseTime', significant: true }];
    expect(regressionTester.generateReport(regressions)).toMatchObject({ status: 'WARN' });
  });

  it('summary counts are accurate', () => {
    const regressions = [
      { severity: 'CRITICAL', metric: 'errorRate', significant: true },
      { severity: 'HIGH', metric: 'avgResponseTime', significant: true },
      { severity: 'MEDIUM', metric: 'p95ResponseTime', significant: true },
      { severity: 'INFO', metric: 'throughput', significant: false },
    ];
    const report = regressionTester.generateReport(regressions);
    expect(report.summary).toEqual({ critical: 1, high: 1, medium: 1, info: 1 });
  });
});

// ─── recordSampleStats ───────────────────────────────────────────────────────
describe('RegressionTester.recordSampleStats', () => {
  it('attaches descriptive stats to the baseline object', () => {
    const baseline = {};
    const samples = { responseTimes: [100, 110, 90, 105, 95, 100, 98, 102, 103, 97] };
    regressionTester.recordSampleStats(baseline, samples);

    expect(baseline.sampleStats).toBeDefined();
    expect(baseline.sampleStats.responseTimes).toMatchObject({
      n: 10,
      mean: expect.any(Number),
      variance: expect.any(Number),
      stdDev: expect.any(Number),
    });
    expect(baseline.sampleStats.responseTimes.n).toBe(10);
  });

  it('ignores empty arrays', () => {
    const baseline = {};
    regressionTester.recordSampleStats(baseline, { responseTimes: [] });
    expect(baseline.sampleStats.responseTimes).toBeUndefined();
  });
});
