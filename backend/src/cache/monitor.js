/**
 * Cache Performance Monitor
 * Monitor and track cache performance metrics
 */

export class CachePerformanceMonitor {
  constructor() {
    this.operations = [];
    this.alerts = [];
    this.thresholds = {
      hitRate: 0.7, // 70%
      avgResponseTime: 100, // ms
      maxSize: 1000,
    };
  }

  recordOperation(operation, duration, success = true) {
    this.operations.push({
      timestamp: Date.now(),
      operation,
      duration,
      success,
    });

    // Keep only last 10000 operations
    if (this.operations.length > 10000) {
      this.operations.shift();
    }

    this.checkThresholds();
  }

  checkThresholds() {
    const recent = this.operations.slice(-100);
    if (recent.length === 0) return;

    const successful = recent.filter((o) => o.success).length;
    const hitRate = successful / recent.length;

    if (hitRate < this.thresholds.hitRate) {
      this.addAlert('LOW_HIT_RATE', `Hit rate ${(hitRate * 100).toFixed(2)}% below threshold`);
    }

    const avgTime = recent.reduce((sum, o) => sum + o.duration, 0) / recent.length;
    if (avgTime > this.thresholds.avgResponseTime) {
      this.addAlert('SLOW_RESPONSE', `Average response time ${avgTime.toFixed(2)}ms exceeds threshold`);
    }
  }

  addAlert(type, message) {
    this.alerts.push({
      timestamp: Date.now(),
      type,
      message,
    });

    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }
  }

  getPerformanceStats() {
    const recent = this.operations.slice(-100);
    if (recent.length === 0) return null;

    const successful = recent.filter((o) => o.success).length;
    const durations = recent.map((o) => o.duration);

    return {
      totalOperations: recent.length,
      successRate: ((successful / recent.length) * 100).toFixed(2) + '%',
      avgDuration: (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2) + 'ms',
      minDuration: Math.min(...durations) + 'ms',
      maxDuration: Math.max(...durations) + 'ms',
    };
  }

  getAlerts() {
    return this.alerts;
  }

  setThreshold(key, value) {
    if (Object.prototype.hasOwnProperty.call(this.thresholds, key)) {
      this.thresholds[key] = value;
    }
  }

  getThresholds() {
    return this.thresholds;
  }
}

export const createCachePerformanceMonitor = () => new CachePerformanceMonitor();
