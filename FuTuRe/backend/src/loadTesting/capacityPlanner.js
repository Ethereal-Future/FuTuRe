class CapacityPlanner {
  calculateCapacity(results, targetErrorRate = 1) {
    const avgResponseTime = results.avgResponseTime;
    const currentErrorRate = results.errorRate;
    const currentThroughput = results.throughput;

    // Calculate max safe throughput based on error rate
    const errorRateRatio = targetErrorRate / Math.max(currentErrorRate, 0.1);
    const maxSafeThroughput = currentThroughput * errorRateRatio;

    // Calculate response time headroom
    const responseTimeHeadroom = 5000 / avgResponseTime; // 5 second max acceptable

    // Conservative estimate
    const maxCapacity = Math.min(maxSafeThroughput, currentThroughput * responseTimeHeadroom);

    return {
      currentThroughput: Math.round(currentThroughput),
      maxSafeThroughput: Math.round(maxSafeThroughput),
      maxCapacity: Math.round(maxCapacity),
      headroom: Math.round((maxCapacity / currentThroughput - 1) * 100),
      recommendations: this.getRecommendations(maxCapacity, currentThroughput)
    };
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
    const projectedThroughput = currentThroughput * Math.pow(1 + growthRate, months);
    const scalingFactor = projectedThroughput / currentThroughput;

    return {
      currentThroughput: Math.round(currentThroughput),
      projectedThroughput: Math.round(projectedThroughput),
      scalingFactor: scalingFactor.toFixed(2),
      months,
      growthRate: (growthRate * 100).toFixed(1),
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
