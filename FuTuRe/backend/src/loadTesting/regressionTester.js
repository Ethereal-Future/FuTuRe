class RegressionTester {
  constructor() {
    this.thresholds = {
      avgResponseTime: 1.1, // 10% increase
      p95ResponseTime: 1.15, // 15% increase
      errorRate: 1.05, // 5% increase
      throughput: 0.9 // 10% decrease
    };
  }

  setThreshold(metric, threshold) {
    this.thresholds[metric] = threshold;
  }

  detectRegression(current, baseline) {
    const regressions = [];

    // Check average response time
    if (current.avgResponseTime > baseline.metrics.avgResponseTime * this.thresholds.avgResponseTime) {
      regressions.push({
        metric: 'avgResponseTime',
        severity: 'HIGH',
        message: `Average response time increased by ${((current.avgResponseTime / baseline.metrics.avgResponseTime - 1) * 100).toFixed(2)}%`,
        current: current.avgResponseTime,
        baseline: baseline.metrics.avgResponseTime
      });
    }

    // Check p95 response time
    if (current.p95ResponseTime > baseline.metrics.p95ResponseTime * this.thresholds.p95ResponseTime) {
      regressions.push({
        metric: 'p95ResponseTime',
        severity: 'MEDIUM',
        message: `P95 response time increased by ${((current.p95ResponseTime / baseline.metrics.p95ResponseTime - 1) * 100).toFixed(2)}%`,
        current: current.p95ResponseTime,
        baseline: baseline.metrics.p95ResponseTime
      });
    }

    // Check error rate
    if (current.errorRate > baseline.metrics.errorRate * this.thresholds.errorRate) {
      regressions.push({
        metric: 'errorRate',
        severity: 'CRITICAL',
        message: `Error rate increased by ${(current.errorRate - baseline.metrics.errorRate).toFixed(2)}%`,
        current: current.errorRate,
        baseline: baseline.metrics.errorRate
      });
    }

    // Check throughput
    if (current.throughput < baseline.metrics.throughput * this.thresholds.throughput) {
      regressions.push({
        metric: 'throughput',
        severity: 'HIGH',
        message: `Throughput decreased by ${((1 - current.throughput / baseline.metrics.throughput) * 100).toFixed(2)}%`,
        current: current.throughput,
        baseline: baseline.metrics.throughput
      });
    }

    return regressions;
  }

  generateReport(regressions) {
    if (regressions.length === 0) {
      return { status: 'PASS', message: 'No performance regressions detected' };
    }

    const critical = regressions.filter(r => r.severity === 'CRITICAL');
    const high = regressions.filter(r => r.severity === 'HIGH');
    const medium = regressions.filter(r => r.severity === 'MEDIUM');

    return {
      status: critical.length > 0 ? 'FAIL' : 'WARN',
      summary: {
        critical: critical.length,
        high: high.length,
        medium: medium.length
      },
      regressions
    };
  }
}

export default new RegressionTester();
