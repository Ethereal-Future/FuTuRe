class BottleneckAnalyzer {
  analyze(results) {
    const bottlenecks = [];

    // Group by endpoint
    const byEndpoint = {};
    for (const result of results) {
      const key = `${result.method} ${result.path}`;
      if (!byEndpoint[key]) {
        byEndpoint[key] = [];
      }
      byEndpoint[key].push(result);
    }

    // Analyze each endpoint
    for (const [endpoint, requests] of Object.entries(byEndpoint)) {
      const responseTimes = requests.map(r => r.responseTime).sort((a, b) => a - b);
      const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const p95Time = responseTimes[Math.floor(responseTimes.length * 0.95)];
      const errorRate = (requests.filter(r => !r.success).length / requests.length) * 100;

      if (avgTime > 500 || p95Time > 1000 || errorRate > 5) {
        bottlenecks.push({
          endpoint,
          avgResponseTime: avgTime,
          p95ResponseTime: p95Time,
          errorRate,
          requestCount: requests.length,
          severity: this.calculateSeverity(avgTime, p95Time, errorRate)
        });
      }
    }

    return bottlenecks.sort((a, b) => b.severity - a.severity);
  }

  calculateSeverity(avgTime, p95Time, errorRate) {
    let severity = 0;
    if (avgTime > 1000) severity += 3;
    else if (avgTime > 500) severity += 2;
    else if (avgTime > 200) severity += 1;

    if (p95Time > 2000) severity += 3;
    else if (p95Time > 1000) severity += 2;

    if (errorRate > 10) severity += 3;
    else if (errorRate > 5) severity += 2;

    return severity;
  }

  getRecommendations(bottlenecks) {
    const recommendations = [];

    for (const bottleneck of bottlenecks) {
      if (bottleneck.avgResponseTime > 1000) {
        recommendations.push({
          endpoint: bottleneck.endpoint,
          issue: 'High average response time',
          recommendation: 'Optimize database queries or add caching',
          priority: 'HIGH'
        });
      }

      if (bottleneck.p95ResponseTime > 2000) {
        recommendations.push({
          endpoint: bottleneck.endpoint,
          issue: 'High p95 response time',
          recommendation: 'Investigate outlier requests and optimize worst-case scenarios',
          priority: 'HIGH'
        });
      }

      if (bottleneck.errorRate > 5) {
        recommendations.push({
          endpoint: bottleneck.endpoint,
          issue: 'High error rate',
          recommendation: 'Review error logs and fix underlying issues',
          priority: 'CRITICAL'
        });
      }
    }

    return recommendations;
  }
}

export default new BottleneckAnalyzer();
