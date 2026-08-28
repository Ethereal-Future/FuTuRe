/**
 * Performance Baseline — stores named baselines in Postgres via Prisma instead
 * of writing per-baseline JSON files to backend/data/load-tests/baselines/.
 * Baselines are now visible to all process instances and survive restarts.
 *
 * Migrated as part of Issue #1125.
 */
import { throughputRps } from './throughput.js';
import prisma from '../db/client.js';

// v1 baselines were produced by the serial for-loop in loadTestRunner
// (issue #1114). They are not comparable to concurrent-worker results.
export const BASELINE_SCHEMA_VERSION = 2;
export const BASELINE_EXECUTION_MODEL = 'concurrent';

class PerformanceBaseline {
  constructor(name) {
    this.name = name;
    this.timestamp = new Date().toISOString();
    this.schemaVersion = BASELINE_SCHEMA_VERSION;
    this.executionModel = BASELINE_EXECUTION_MODEL;
    this.metrics = {
      avgResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      maxResponseTime: 0,
      minResponseTime: Infinity,
      /** Throughput in requests per second (req/s). */
      throughput: 0,
      errorRate: 0,
      successCount: 0,
      errorCount: 0,
      totalRequests: 0,
    };
  }

  /**
   * Derive baseline metrics from raw request results.
   * `metrics.throughput` is requests per second (req/s).
   */
  calculateFromResults(results) {
    const responseTimes = results.map((r) => r.responseTime).sort((a, b) => a - b);
    const total = responseTimes.length;

    this.metrics.totalRequests = total;
    this.metrics.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / total;
    this.metrics.p95ResponseTime = responseTimes[Math.floor(total * 0.95)];
    this.metrics.p99ResponseTime = responseTimes[Math.floor(total * 0.99)];
    this.metrics.maxResponseTime = Math.max(...responseTimes);
    this.metrics.minResponseTime = Math.min(...responseTimes);
    this.metrics.successCount = results.filter((r) => r.success).length;
    this.metrics.errorCount = results.filter((r) => !r.success).length;
    this.metrics.errorRate = (this.metrics.errorCount / total) * 100;
    const elapsedMs = results[total - 1].timestamp - results[0].timestamp;
    this.metrics.throughput = throughputRps(total, elapsedMs);

    return this;
  }

  static isConcurrentModel(baseline) {
    if (!baseline || typeof baseline !== 'object') return false;
    return (
      baseline.executionModel === BASELINE_EXECUTION_MODEL ||
      baseline.schemaVersion === BASELINE_SCHEMA_VERSION
    );
  }

  /**
   * Persist this baseline to Postgres.
   * @returns {Promise<string>} the generated record id
   */
  async save() {
    const record = await prisma.performanceBaseline.create({
      data: {
        name: this.name,
        schemaVersion: this.schemaVersion,
        executionModel: this.executionModel,
        metrics: this.metrics,
      },
    });
    return record.id;
  }

  /**
   * Load the most recently created baseline with the given name.
   * @param {string} name
   * @returns {Promise<object|null>}
   */
  static async getLatest(name) {
    const record = await prisma.performanceBaseline.findFirst({
      where: { name },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) return null;

    return {
      name: record.name,
      timestamp: record.createdAt.toISOString(),
      schemaVersion: record.schemaVersion,
      executionModel: record.executionModel,
      metrics: record.metrics,
    };
  }

  compareWith(other) {
    if (
      !PerformanceBaseline.isConcurrentModel(this) ||
      !PerformanceBaseline.isConcurrentModel(other)
    ) {
      return {
        incomparable: true,
        reason:
          'Prior serial-execution baselines (pre-#1114) are not comparable to concurrent results. Re-generate the baseline before using bottleneck/capacity/regression output.',
      };
    }

    return {
      avgResponseTimeDiff:
        ((this.metrics.avgResponseTime - other.metrics.avgResponseTime) /
          other.metrics.avgResponseTime) *
        100,
      p95ResponseTimeDiff:
        ((this.metrics.p95ResponseTime - other.metrics.p95ResponseTime) /
          other.metrics.p95ResponseTime) *
        100,
      errorRateDiff: this.metrics.errorRate - other.metrics.errorRate,
      throughputDiff:
        ((this.metrics.throughput - other.metrics.throughput) / other.metrics.throughput) * 100,
    };
  }
}

export default PerformanceBaseline;
