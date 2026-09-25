/**
 * Performance Alerting — stores threshold violation alerts in Postgres via
 * Prisma instead of writing per-run JSON files to
 * backend/data/load-tests/alerts/.  Alerts are now visible to all process
 * instances and survive restarts.
 *
 * Migrated as part of Issue #1125.
 */
import prisma from '../db/client.js';

class PerformanceAlerting {
  constructor() {
    this.alerts = [];
    this.thresholds = {
      avgResponseTime: 1000,
      p95ResponseTime: 2000,
      errorRate: 5,
      throughput: 10,
    };
  }

  setThreshold(metric, value) {
    this.thresholds[metric] = value;
  }

  checkMetrics(results) {
    const newAlerts = [];

    if (results.avgResponseTime > this.thresholds.avgResponseTime) {
      newAlerts.push({
        alertType: 'PERFORMANCE',
        severity: 'HIGH',
        metric: 'avgResponseTime',
        message: `Average response time ${results.avgResponseTime.toFixed(2)}ms exceeds threshold ${this.thresholds.avgResponseTime}ms`,
        value: results.avgResponseTime,
        threshold: this.thresholds.avgResponseTime,
        timestamp: new Date().toISOString(),
      });
    }

    if (results.p95ResponseTime > this.thresholds.p95ResponseTime) {
      newAlerts.push({
        alertType: 'PERFORMANCE',
        severity: 'MEDIUM',
        metric: 'p95ResponseTime',
        message: `P95 response time ${results.p95ResponseTime.toFixed(2)}ms exceeds threshold ${this.thresholds.p95ResponseTime}ms`,
        value: results.p95ResponseTime,
        threshold: this.thresholds.p95ResponseTime,
        timestamp: new Date().toISOString(),
      });
    }

    if (results.errorRate > this.thresholds.errorRate) {
      newAlerts.push({
        alertType: 'ERROR',
        severity: 'CRITICAL',
        metric: 'errorRate',
        message: `Error rate ${results.errorRate.toFixed(2)}% exceeds threshold ${this.thresholds.errorRate}%`,
        value: results.errorRate,
        threshold: this.thresholds.errorRate,
        timestamp: new Date().toISOString(),
      });
    }

    if (results.throughput < this.thresholds.throughput) {
      newAlerts.push({
        alertType: 'PERFORMANCE',
        severity: 'HIGH',
        metric: 'throughput',
        message: `Throughput ${results.throughput.toFixed(2)} req/s is below threshold ${this.thresholds.throughput} req/s`,
        value: results.throughput,
        threshold: this.thresholds.throughput,
        timestamp: new Date().toISOString(),
      });
    }

    this.alerts.push(...newAlerts);
    return newAlerts;
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
