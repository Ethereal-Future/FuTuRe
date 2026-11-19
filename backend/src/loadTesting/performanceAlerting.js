/**
 * Performance Alerting — stores threshold violation alerts in Postgres via
 * Prisma instead of writing per-run JSON files to
 * backend/data/load-tests/alerts/.  Alerts are now visible to all process
 * instances and survive restarts.
 *
 * Migrated as part of Issue #1125.
 */
import prisma from '../db/client.js';
import { createRedisBackend } from '../cache/redis.js';

// Module-level Redis backend, only created when Redis is configured.
// Guarded so that environments without Redis keep working unchanged.
let redisBackend = null;
try {
  redisBackend = createRedisBackend();
} catch {
  redisBackend = null;
}

// Circuit-breaker: when Redis fails repeatedly we degrade to in-memory
// deduplication for a while instead of throwing on every alert.
const REDIS_DISABLE_MS = 30000;

class PerformanceAlerting {
  constructor(options = {}) {
    this.alerts = [];
    this.thresholds = {
      avgResponseTime: 1000,
      p95ResponseTime: 2000,
      errorRate: 5,
      throughput: 10,
    };
    this.cooldownSeconds = options.cooldownSeconds ?? 300;
    this.redisBackend = options.redisBackend ?? redisBackend;
    this.workerId = options.workerId ?? process.env.WORKER_ID ?? process.pid;
    // In-memory fallback map: metric -> timestamp (ms)
    this.lastAlertTime = new Map();
    // When set (ms epoch), Redis is skipped until this time.
    this.redisDisabledUntil = 0;
  }

  /**
   * Attempt to atomically claim the right to dispatch an alert for a metric.
   * Returns true when this worker should dispatch, false when another worker
   * (or a previous dispatch) already claimed it within the cooldown window.
   */
  async _claimAlert(testName, metric) {
    const now = Date.now();
    const key = `loadtest:alert:${testName ?? 'default'}:${metric}`;

    if (this.redisBackend && this.redisBackend.client && now >= this.redisDisabledUntil) {
      try {
        const claimed = await this.redisBackend.setNX(
          key,
          { timestamp: now, workerId: this.workerId },
          this.cooldownSeconds,
        );
        if (claimed) return true;
        return false;
      } catch {
        // Degrade gracefully: trip the circuit breaker and fall through to
        // the in-memory path so alerting keeps working.
        this.redisDisabledUntil = now + REDIS_DISABLE_MS;
      }
    }

    // In-memory fallback (single-process behaviour preserved).
    const last = this.lastAlertTime.get(metric);
    if (last !== undefined && now - last < this.cooldownSeconds * 1000) {
      return false;
    }
    this.lastAlertTime.set(metric, now);
    return true;
  }

  setThreshold(metric, value) {
    this.thresholds[metric] = value;
  }

  /**
   * Evaluate metrics against thresholds and dispatch at most one aggregated
   * incident alert per cooldown window across the whole worker cluster.
   *
   * @param {object} results
   * @param {object} [options]
   * @param {string} [options.testName] — optional test name used for the dedup key
   * @returns {Promise<object[]>} dispatched alerts (empty when throttled)
   */
  async checkMetrics(results, options = {}) {
    const testName = options.testName;
    const breaches = [];

    if (results.avgResponseTime > this.thresholds.avgResponseTime) {
      breaches.push({
        alertType: 'PERFORMANCE',
        severity: 'HIGH',
        metric: 'avgResponseTime',
        message: `Average response time ${results.avgResponseTime.toFixed(2)}ms exceeds threshold ${this.thresholds.avgResponseTime}ms`,
        value: results.avgResponseTime,
        threshold: this.thresholds.avgResponseTime,
      });
    }

    if (results.p95ResponseTime > this.thresholds.p95ResponseTime) {
      breaches.push({
        alertType: 'PERFORMANCE',
        severity: 'MEDIUM',
        metric: 'p95ResponseTime',
        message: `P95 response time ${results.p95ResponseTime.toFixed(2)}ms exceeds threshold ${this.thresholds.p95ResponseTime}ms`,
        value: results.p95ResponseTime,
        threshold: this.thresholds.p95ResponseTime,
      });
    }

    if (results.errorRate > this.thresholds.errorRate) {
      breaches.push({
        alertType: 'ERROR',
        severity: 'CRITICAL',
        metric: 'errorRate',
        message: `Error rate ${results.errorRate.toFixed(2)}% exceeds threshold ${this.thresholds.errorRate}%`,
        value: results.errorRate,
        threshold: this.thresholds.errorRate,
      });
    }

    if (results.throughput < this.thresholds.throughput) {
      breaches.push({
        alertType: 'PERFORMANCE',
        severity: 'HIGH',
        metric: 'throughput',
        message: `Throughput ${results.throughput.toFixed(2)} req/s is below threshold ${this.thresholds.throughput} req/s`,
        value: results.throughput,
        threshold: this.thresholds.throughput,
      });
    }

    if (breaches.length === 0) return [];

    // Claim the cooldown window once for the whole incident (all breached
    // metrics share a single aggregated alert). The claim key is derived from
    // the test name so multi-worker metrics collapse into one incident.
    const claimed = await this._claimAlert(testName, 'incident');
    if (!claimed) return [];

    const timestamp = new Date().toISOString();
    const severities = breaches.map((b) => b.severity);
    const severity = severities.includes('CRITICAL')
      ? 'CRITICAL'
      : severities.includes('HIGH')
        ? 'HIGH'
        : 'MEDIUM';

    const incident = {
      alertType: breaches.some((b) => b.alertType === 'ERROR') ? 'ERROR' : 'PERFORMANCE',
      severity,
      metric: breaches.map((b) => b.metric).join(','),
      message: `Performance incident: ${breaches.length} metric(s) breached thresholds — ${breaches
        .map((b) => `${b.metric}=${Number(b.value).toFixed(2)} (threshold ${b.threshold})`)
        .join('; ')}`,
      value: breaches[0].value,
      threshold: breaches[0].threshold,
      timestamp,
      workerId: this.workerId,
      metrics: breaches.map((b) => ({
        metric: b.metric,
        severity: b.severity,
        value: b.value,
        threshold: b.threshold,
        message: b.message,
      })),
    };

    this.alerts.push(incident);
    return [incident];
  }

  /**
   * Persist all accumulated in-memory alerts to Postgres.
   * @param {string} [testName]  — optional test name to tag each alert
   * @returns {Promise<void>}
   */
  async saveAlerts(testName) {
    if (this.alerts.length === 0) return;

    await prisma.performanceAlert.createMany({
      data: this.alerts.map((a) => ({
        testName: testName ?? null,
        alertType: a.alertType,
        severity: a.severity,
        metric: a.metric,
        message: a.message,
        value: a.value,
        threshold: a.threshold,
      })),
    });

    // Clear the in-memory buffer after persisting
    this.alerts = [];
  }

  /**
   * Retrieve the most recent `limit` alerts from Postgres.
   * @param {number} [limit=100]
   * @returns {Promise<object[]>}
   */
  static async getAlerts(limit = 100) {
    const records = await prisma.performanceAlert.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return records.map((r) => ({
      id: r.id,
      testName: r.testName,
      type: r.alertType,
      severity: r.severity,
      metric: r.metric,
      message: r.message,
      value: r.value,
      threshold: r.threshold,
      timestamp: r.createdAt.toISOString(),
    }));
  }

  /**
   * Retrieve only CRITICAL severity alerts.
   * @returns {Promise<object[]>}
   */
  static async getCriticalAlerts() {
    const records = await prisma.performanceAlert.findMany({
      where: { severity: 'CRITICAL' },
      orderBy: { createdAt: 'desc' },
    });

    return records.map((r) => ({
      id: r.id,
      testName: r.testName,
      type: r.alertType,
      severity: r.severity,
      metric: r.metric,
      message: r.message,
      value: r.value,
      threshold: r.threshold,
      timestamp: r.createdAt.toISOString(),
    }));
  }
}

export default new PerformanceAlerting();
