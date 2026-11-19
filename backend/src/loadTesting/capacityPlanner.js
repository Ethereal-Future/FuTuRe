class CapacityPlanner {
  calculateCapacity(results, targetErrorRate = 1) {
    const avgResponseTime = Number(results.avgResponseTime);
    const currentErrorRate = Number(results.errorRate);
    const currentThroughput = Number(results.throughput);
    const safeTargetErrorRate = Number.isFinite(Number(targetErrorRate))
      ? Number(targetErrorRate)
      : 1;

    // Guard against zero-traffic / failed runs: no throughput means no capacity.
    if (!Number.isFinite(currentThroughput) || currentThroughput <= 0) {
      return {
        currentThroughput: 0,
        maxSafeThroughput: 0,
        maxCapacity: 0,
        headroom: 0,
        recommendations: []
      };
    }

    // Calculate max safe throughput based on error rate
    const safeErrorRate = Number.isFinite(currentErrorRate) && currentErrorRate > 0
      ? currentErrorRate
      : 0.1;
    const errorRateRatio = safeTargetErrorRate / Math.max(safeErrorRate, 0.1);
    const maxSafeThroughput = currentThroughput * errorRateRatio;

    // Dimensionless latency headroom vs a 5000ms (5s) max acceptable avg
    // response time. Independent of throughput units (both this planner and
    // LoadTestRunner/PerformanceBaseline use req/s).
    const safeAvgResponseTime = Math.max(Number(avgResponseTime) || 1, 1);
    const responseTimeHeadroom = 5000 / safeAvgResponseTime;

    // Conservative estimate
    const maxCapacity = Math.min(maxSafeThroughput, currentThroughput * responseTimeHeadroom);

    const headroom = Math.max(0, (maxCapacity / currentThroughput - 1) * 100);

    return {
      currentThroughput: this.toFiniteInt(currentThroughput),
      maxSafeThroughput: this.toFiniteInt(maxSafeThroughput),
      maxCapacity: this.toFiniteInt(maxCapacity),
      headroom: this.toFiniteInt(headroom),
      recommendations: this.getRecommendations(maxCapacity, currentThroughput)
    };
  }

  toFiniteInt(value) {
    return Number.isFinite(value) ? Math.round(value) : 0;
  }

  getRecommendations(maxCapacity, currentThroughput) {
    const recommendations = [];

    if (maxCapacity < currentThroughput * 1.5) {
      recommendations.push({
        priority: 'HIGH',
        message: 'Limited capacity headroom. Consider optimization or scaling.'
      });
    }

    if (maxCapacity < currentThroughput * 2) {
      recommendations.push({
        priority: 'MEDIUM',
        message: 'Plan for scaling within 6 months based on growth projections.'
      });
    }

    if (maxCapacity > currentThroughput * 5) {
      recommendations.push({
        priority: 'LOW',
        message: 'Adequate capacity for current and near-term growth.'
      });
    }

    return recommendations;
  }

  estimateScalingNeeds(currentThroughput, growthRate, months) {
    const safeThroughput = Number(currentThroughput);
    const safeGrowthRate = Number.isFinite(Number(growthRate)) ? Number(growthRate) : 0;
    const safeMonths = Number.isFinite(Number(months)) ? Number(months) : 0;

    if (!Number.isFinite(safeThroughput) || safeThroughput <= 0) {
      return {
        currentThroughput: 0,
        projectedThroughput: 0,
        scalingFactor: '0.00',
        months: safeMonths,
        growthRate: (safeGrowthRate * 100).toFixed(1),
        recommendations: []
      };
    }

    const projectedThroughput = safeThroughput * Math.pow(1 + safeGrowthRate, safeMonths);
    const rawScalingFactor = projectedThroughput / safeThroughput;
    const scalingFactor = Number.isFinite(rawScalingFactor) ? rawScalingFactor : 0;

    return {
      currentThroughput: this.toFiniteInt(safeThroughput),
      projectedThroughput: this.toFiniteInt(projectedThroughput),
      scalingFactor: scalingFactor.toFixed(2),
      months: safeMonths,
      growthRate: (safeGrowthRate * 100).toFixed(1),
      recommendations: this.getScalingRecommendations(scalingFactor)
    };
  }

  getScalingRecommendations(scalingFactor) {
    const recommendations = [];

    if (scalingFactor > 3) {
      recommendations.push('Consider horizontal scaling with load balancing');
      recommendations.push('Implement database replication and sharding');
      recommendations.push('Deploy caching layer (Redis/Memcached)');
    } else if (scalingFactor > 2) {
      recommendations.push('Optimize application performance');
      recommendations.push('Add caching for frequently accessed data');
      recommendations.push('Consider vertical scaling');
    } else if (scalingFactor > 1.5) {
      recommendations.push('Monitor performance metrics closely');
      recommendations.push('Optimize database queries');
    }

    return recommendations;
  }
}

export default new CapacityPlanner();
