/**
 * Service Monitoring
 * Monitor service health and metrics
 */

export class ServiceMonitor {
  constructor() {
    this.metrics = new Map();
    this.healthChecks = new Map();
    this.alerts = [];
  }

  recordMetric(serviceName, metricName, value) {
    const key = `${serviceName}:${metricName}`;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }

    this.metrics.get(key).push({
      timestamp: Date.now(),
      value,
    });

    // Keep only last 1000 entries
    const entries = this.metrics.get(key);
    if (entries.length > 1000) {
      entries.shift();
    }
  }

  registerHealthCheck(serviceName, checkFn) {
    this.healthChecks.set(serviceName, checkFn);
    return this;
  }

  async checkHealth(serviceName) {
    const checkFn = this.healthChecks.get(serviceName);
    if (!checkFn) {
      return { service: serviceName, status: 'unknown' };
    }

    try {
      const result = await checkFn();
      return {
        service: serviceName,
        status: result ? 'healthy' : 'unhealthy',
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        service: serviceName,
        status: 'unhealthy',
        error: error.message,
        timestamp: Date.now(),
      };
    }
  }

  async checkAllHealth() {
    const results = [];
    for (const serviceName of this.healthChecks.keys()) {
      results.push(await this.checkHealth(serviceName));
    }
    return results;
  }

  getMetrics(serviceName) {
    const metrics = {};
    for (const [key, values] of this.metrics.entries()) {
      if (key.startsWith(serviceName)) {
        const metricName = key.split(':')[1];
        metrics[metricName] = {
          latest: values[values.length - 1]?.value,
          average: values.reduce((sum, v) => sum + v.value, 0) / values.length,
          count: values.length,
        };
      }
    }
    return metrics;
  }

  addAlert(serviceName, severity, message) {
    this.alerts.push({
      timestamp: Date.now(),
      service: serviceName,
      severity,
      message,
    });

    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }
  }

  getAlerts() {
    return this.alerts;
  }
}

export const createServiceMonitor = () => new ServiceMonitor();
