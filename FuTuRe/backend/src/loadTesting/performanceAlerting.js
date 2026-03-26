import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALERTS_DIR = path.join(__dirname, '../../data/load-tests/alerts');

class PerformanceAlerting {
  constructor() {
    this.alerts = [];
    this.thresholds = {
      avgResponseTime: 1000,
      p95ResponseTime: 2000,
      errorRate: 5,
      throughput: 10
    };
  }

  setThreshold(metric, value) {
    this.thresholds[metric] = value;
  }

  checkMetrics(results) {
    const newAlerts = [];

    if (results.avgResponseTime > this.thresholds.avgResponseTime) {
      newAlerts.push({
        type: 'PERFORMANCE',
        severity: 'HIGH',
        metric: 'avgResponseTime',
        message: `Average response time ${results.avgResponseTime.toFixed(2)}ms exceeds threshold ${this.thresholds.avgResponseTime}ms`,
        value: results.avgResponseTime,
        threshold: this.thresholds.avgResponseTime,
        timestamp: new Date().toISOString()
      });
    }

    if (results.p95ResponseTime > this.thresholds.p95ResponseTime) {
      newAlerts.push({
        type: 'PERFORMANCE',
        severity: 'MEDIUM',
        metric: 'p95ResponseTime',
        message: `P95 response time ${results.p95ResponseTime.toFixed(2)}ms exceeds threshold ${this.thresholds.p95ResponseTime}ms`,
        value: results.p95ResponseTime,
        threshold: this.thresholds.p95ResponseTime,
        timestamp: new Date().toISOString()
      });
    }

    if (results.errorRate > this.thresholds.errorRate) {
      newAlerts.push({
        type: 'ERROR',
        severity: 'CRITICAL',
        metric: 'errorRate',
        message: `Error rate ${results.errorRate.toFixed(2)}% exceeds threshold ${this.thresholds.errorRate}%`,
        value: results.errorRate,
        threshold: this.thresholds.errorRate,
        timestamp: new Date().toISOString()
      });
    }

    if (results.throughput < this.thresholds.throughput) {
      newAlerts.push({
        type: 'PERFORMANCE',
        severity: 'HIGH',
        metric: 'throughput',
        message: `Throughput ${results.throughput.toFixed(2)} req/s is below threshold ${this.thresholds.throughput} req/s`,
        value: results.throughput,
        threshold: this.thresholds.throughput,
        timestamp: new Date().toISOString()
      });
    }

    this.alerts.push(...newAlerts);
    return newAlerts;
  }

  async saveAlerts() {
    await fs.mkdir(ALERTS_DIR, { recursive: true });
    const file = path.join(ALERTS_DIR, `alerts-${Date.now()}.json`);
    await fs.writeFile(file, JSON.stringify(this.alerts, null, 2));
    return file;
  }

  static async getAlerts(limit = 100) {
    try {
      await fs.mkdir(ALERTS_DIR, { recursive: true });
      const files = await fs.readdir(ALERTS_DIR);
      const allAlerts = [];

      for (const file of files.sort().reverse().slice(0, 10)) {
        const content = await fs.readFile(path.join(ALERTS_DIR, file), 'utf-8');
        const alerts = JSON.parse(content);
        allAlerts.push(...alerts);
      }

      return allAlerts.slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  static async getCriticalAlerts() {
    const alerts = await this.getAlerts();
    return alerts.filter(a => a.severity === 'CRITICAL');
  }
}

export default new PerformanceAlerting();
