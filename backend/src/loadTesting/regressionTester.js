/**
 * Regression Tester — fixes #1415.
 *
 * Previous design: a plain percentage threshold (5 %) flagged regressions
 * regardless of statistical significance.  On shared CI runners this caused
 * frequent false-positive failures for fast endpoints where the absolute
 * difference was within measurement noise (e.g. 2 ms → 2.2 ms).
 *
 * New design adds:
 *  • Welch's t-test to assess whether the difference between current and
 *    baseline sample distributions is statistically significant.
 *  • Standard deviation, standard error, and effective sample size are
 *    stored alongside the baseline metrics so comparisons can be meaningful.
 *  • A configurable minimum t-statistic threshold (default: p < 0.05,
 *    two-tailed, approximated via |t| > 2.0 for n ≥ 10) gates every
 *    regression detection.
 *  • Existing percentage-threshold API is fully preserved; statistical
 *    gating is additive — a regression requires *both* the percentage
 *    threshold to be exceeded *and* the result to be statistically
 *    significant (unless the sample is too small to judge, in which case
 *    it falls back to percentage-only with a warning flag).
 */

import PerformanceBaseline, { BASELINE_EXECUTION_MODEL } from './performanceBaseline.js';

// ---------------------------------------------------------------------------
// Statistical helpers
// ---------------------------------------------------------------------------

/**
 * Compute mean, variance, and standard deviation for an array of numbers.
 *
 * @param {number[]} values
 * @returns {{ mean: number, variance: number, stdDev: number, n: number }}
 */
export function descriptiveStats(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, variance: 0, stdDev: 0, n: 0 };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = n > 1
    ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
    : 0;
  return { mean, variance, stdDev: Math.sqrt(variance), n };
}

/**
 * Welch's two-sample t-statistic (unequal variances, unequal n).
 *
 * Returns the absolute t value.  Returns 0 when the pooled standard error
 * is zero (identical distributions or constant samples).
 *
 * @param {{ mean: number, variance: number, n: number }} a  Current stats.
 * @param {{ mean: number, variance: number, n: number }} b  Baseline stats.
 * @returns {number} |t|
 */
export function welchT(a, b) {
  const se2 = a.variance / a.n + b.variance / b.n;
  if (se2 === 0) return 0;
  return Math.abs((a.mean - b.mean) / Math.sqrt(se2));
}

/**
 * Approximate Welch–Satterthwaite degrees of freedom.
 *
 * @param {{ variance: number, n: number }} a
 * @param {{ variance: number, n: number }} b
 * @returns {number}
 */
export function welchDf(a, b) {
  const se2 = a.variance / a.n + b.variance / b.n;
  if (se2 === 0) return Infinity;
  const num = se2 ** 2;
  const den =
    (a.variance / a.n) ** 2 / (a.n - 1) + (b.variance / b.n) ** 2 / (b.n - 1);
  return den === 0 ? Infinity : num / den;
}

/**
 * Conservative two-tailed critical t value for α = 0.05.
 *
 * Uses a lookup table for common degrees of freedom.  For large df (≥ 120)
 * falls back to the z-score 1.960.
 *
 * @param {number} df
 * @returns {number}
 */
export function criticalT(df) {
  // Two-tailed α = 0.05 critical values from the t-distribution table.
  const TABLE = [
    [1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571],
    [6, 2.447],  [7, 2.365], [8, 2.306], [9, 2.262], [10, 2.228],
    [12, 2.179], [15, 2.131], [20, 2.086], [25, 2.060], [30, 2.042],
    [40, 2.021], [60, 2.000], [80, 1.990], [100, 1.984], [120, 1.980],
  ];
  if (!isFinite(df) || df >= 120) return 1.960;
  // Find bracketing entries.
  for (let i = TABLE.length - 1; i >= 0; i--) {
    if (df >= TABLE[i][0]) return TABLE[i][1];
  }
  return TABLE[0][1]; // df < 1 — return the most conservative value
}

/**
 * Return true when the observed t-statistic exceeds the critical value for
 * the computed degrees of freedom (α = 0.05, two-tailed).
 *
 * @param {{ variance: number, n: number }} current
 * @param {{ variance: number, n: number }} baseline
 * @param {number} tStat
 * @returns {boolean}
 */
export function isSignificant(current, baseline, tStat) {
  const df = welchDf(current, baseline);
  const tc = criticalT(df);
  return tStat > tc;
}

// Minimum sample size below which we cannot reliably judge statistical
// significance.  Comparisons with fewer samples fall back to percentage-only
// and are flagged with `insufficientSamples: true`.
const MIN_SAMPLE_SIZE = 10;

// ---------------------------------------------------------------------------
// RegressionTester class
// ---------------------------------------------------------------------------

class RegressionTester {
  constructor() {
    /**
     * Percentage-threshold multipliers (same as before).
     * A regression is only reported when *both* the percentage threshold is
     * exceeded *and* the result is statistically significant (or the sample
     * is too small to judge).
     */
    this.thresholds = {
      avgResponseTime: 1.1,    // 10 % increase
      p95ResponseTime: 1.15,   // 15 % increase
      errorRate: 1.05,         // 5 % increase
      throughput: 0.9,         // 10 % decrease
    };

    /**
     * When true, a regression that passes the percentage threshold but is
     * *not* statistically significant is downgraded to a warning rather than
     * a failure.  Set to false to disable statistical gating entirely
     * (not recommended for shared CI runners).
     */
    this.requireSignificance = true;
  }

  /**
   * Override a percentage threshold.
   *
   * @param {string} metric
   * @param {number} threshold
   */
  setThreshold(metric, threshold) {
    this.thresholds[metric] = threshold;
  }

  /**
   * Detect performance regressions.
   *
   * `current` may optionally include per-metric sample arrays
   * (`responseTimes`, `p95Samples`, `throughputSamples`) for statistical
   * testing.  If those arrays are absent the tester falls back to
   * percentage-only comparison (same behaviour as before, flagged with
   * `insufficientSamples: true`).
   *
   * `baseline` must be a PerformanceBaseline snapshot.  If it includes
   * `sampleStats` (populated by `recordSampleStats()` below), statistical
   * testing is performed against the stored distributions.
   *
   * @param {{
   *   avgResponseTime: number,
   *   p95ResponseTime: number,
   *   errorRate: number,
   *   throughput: number,
   *   responseTimes?: number[],
   *   p95Samples?: number[],
   *   throughputSamples?: number[],
   * }} current
   * @param {object} baseline  Snapshot from PerformanceBaseline.getLatest().
   * @returns {Array<object>}
   */
  detectRegression(current, baseline) {
    const regressions = [];

    if (!PerformanceBaseline.isConcurrentModel(baseline)) {
      regressions.push({
        metric: 'executionModel',
        severity: 'CRITICAL',
        message:
          'Stored baseline was generated under serial (pre-#1114) execution and is not comparable. Re-generate the baseline.',
        current: BASELINE_EXECUTION_MODEL,
        baseline: baseline?.executionModel ?? 'serial',
      });
      return regressions;
    }

    const bStats = baseline.sampleStats ?? {};

    // Helper: evaluate one metric for regression.
    const check = ({
      metric,
      currentValue,
      baselineValue,
      threshold,
      severity,
      buildMessage,
      isDecreaseRegression = false,
      currentSamples,
      baselineStat,
    }) => {
      const exceeded = isDecreaseRegression
        ? currentValue < baselineValue * threshold
        : currentValue > baselineValue * threshold;

      if (!exceeded) return;

      let statisticalNote = null;
      let insufficientSamples = false;
      let significant = true; // default: assume significant when no data

      if (this.requireSignificance && currentSamples && baselineStat) {
        const nCurrent = currentSamples.length;
        const nBaseline = baselineStat.n ?? 0;

        if (nCurrent < MIN_SAMPLE_SIZE || nBaseline < MIN_SAMPLE_SIZE) {
          insufficientSamples = true;
          statisticalNote = `Insufficient samples for t-test (current n=${nCurrent}, baseline n=${nBaseline}). Result may be noise.`;
        } else {
          const currentStats = descriptiveStats(currentSamples);
          const t = welchT(currentStats, baselineStat);
          const df = welchDf(currentStats, baselineStat);
          significant = isSignificant(currentStats, baselineStat, t);
          statisticalNote = significant
            ? `Statistically significant: t=${t.toFixed(3)}, df=${df.toFixed(1)} (α=0.05)`
            : `Not statistically significant: t=${t.toFixed(3)}, df=${df.toFixed(1)} — likely measurement noise`;
        }
      }

      // Skip (or downgrade) if statistical gating says it's just noise.
      if (this.requireSignificance && !insufficientSamples && !significant) {
        // Downgrade to INFO — not a real regression.
        regressions.push({
          metric,
          severity: 'INFO',
          message: `${buildMessage()} — ${statisticalNote}`,
          current: currentValue,
          baseline: baselineValue,
          significant: false,
          insufficientSamples: false,
          statisticalNote,
        });
        return;
      }

      regressions.push({
        metric,
        severity,
        message: `${buildMessage()}${statisticalNote ? ` — ${statisticalNote}` : ''}`,
        current: currentValue,
        baseline: baselineValue,
        significant,
        insufficientSamples,
        statisticalNote,
      });
    };

    // --- Average response time ---
    check({
      metric: 'avgResponseTime',
      currentValue: current.avgResponseTime,
      baselineValue: baseline.metrics.avgResponseTime,
      threshold: this.thresholds.avgResponseTime,
      severity: 'HIGH',
      buildMessage: () =>
        `Average response time increased by ${((current.avgResponseTime / baseline.metrics.avgResponseTime - 1) * 100).toFixed(2)}%`,
      currentSamples: current.responseTimes,
      baselineStat: bStats.responseTimes,
    });

    // --- P95 response time ---
    check({
      metric: 'p95ResponseTime',
      currentValue: current.p95ResponseTime,
      baselineValue: baseline.metrics.p95ResponseTime,
      threshold: this.thresholds.p95ResponseTime,
      severity: 'MEDIUM',
      buildMessage: () =>
        `P95 response time increased by ${((current.p95ResponseTime / baseline.metrics.p95ResponseTime - 1) * 100).toFixed(2)}%`,
      currentSamples: current.p95Samples,
      baselineStat: bStats.p95Samples,
    });

    // --- Error rate ---
    check({
      metric: 'errorRate',
      currentValue: current.errorRate,
      baselineValue: baseline.metrics.errorRate,
      threshold: this.thresholds.errorRate,
      severity: 'CRITICAL',
      buildMessage: () =>
        `Error rate increased by ${(current.errorRate - baseline.metrics.errorRate).toFixed(2)}%`,
      currentSamples: current.errorRateSamples,
      baselineStat: bStats.errorRateSamples,
    });

    // --- Throughput (decrease = regression) ---
    check({
      metric: 'throughput',
      currentValue: current.throughput,
      baselineValue: baseline.metrics.throughput,
      threshold: this.thresholds.throughput,
      severity: 'HIGH',
      isDecreaseRegression: true,
      buildMessage: () =>
        `Throughput decreased by ${((1 - current.throughput / baseline.metrics.throughput) * 100).toFixed(2)}%`,
      currentSamples: current.throughputSamples,
      baselineStat: bStats.throughputSamples,
    });

    return regressions;
  }

  /**
   * Compute and attach sample statistics to a baseline object so that future
   * `detectRegression()` calls can perform statistical comparisons.
   *
   * Call this before `baseline.save()` when recording a new baseline.
   *
   * @param {object} baseline  PerformanceBaseline instance or plain object.
   * @param {{
   *   responseTimes?: number[],
   *   p95Samples?: number[],
   *   throughputSamples?: number[],
   *   errorRateSamples?: number[],
   * }} samples
   * @returns {object} The baseline with `sampleStats` populated.
   */
  recordSampleStats(baseline, samples = {}) {
    baseline.sampleStats = {};
    for (const [key, arr] of Object.entries(samples)) {
      if (Array.isArray(arr) && arr.length > 0) {
        baseline.sampleStats[key] = descriptiveStats(arr);
      }
    }
    return baseline;
  }

  /**
   * Generate a human-readable report from detected regressions.
   *
   * The status logic now accounts for statistical significance:
   *  • FAIL  — at least one CRITICAL or HIGH regression that is significant
   *             (or where sample size was too small to judge).
   *  • WARN  — regressions present but all are MEDIUM / INFO / noise.
   *  • PASS  — no regressions (or only INFO items flagged as noise).
   *
   * @param {Array<object>} regressions  Output of `detectRegression()`.
   * @returns {object}
   */
  generateReport(regressions) {
    // Exclude INFO-level noise entries from the failure decision.
    const real = regressions.filter((r) => r.severity !== 'INFO');

    if (real.length === 0 && regressions.length === 0) {
      return { status: 'PASS', message: 'No performance regressions detected' };
    }

    if (real.length === 0) {
      return {
        status: 'PASS',
        message: 'Percentage thresholds exceeded but differences are not statistically significant (measurement noise)',
        regressions,
      };
    }

    const critical = real.filter((r) => r.severity === 'CRITICAL');
    const high = real.filter((r) => r.severity === 'HIGH');
    const medium = real.filter((r) => r.severity === 'MEDIUM');
    const info = regressions.filter((r) => r.severity === 'INFO');

    return {
      status: critical.length > 0 || high.length > 0 ? 'FAIL' : 'WARN',
      summary: {
        critical: critical.length,
        high: high.length,
        medium: medium.length,
        info: info.length,
      },
      regressions,
    };
  }
}

export default new RegressionTester();
