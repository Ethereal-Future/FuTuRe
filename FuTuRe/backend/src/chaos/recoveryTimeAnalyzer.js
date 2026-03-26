class RecoveryTimeAnalyzer {
  constructor() {
    this.recoveryMetrics = [];
  }

  recordRecovery(serviceId, failureType, downtime, recoveryActions = []) {
    const metric = {
      serviceId,
      failureType,
      downtime,
      recoveryActions,
      timestamp: new Date().toISOString(),
      recoveryTime: downtime,
      recovered: true
    };

    this.recoveryMetrics.push(metric);
    return metric;
  }

  calculateMTTR(serviceId = null) {
    let metrics = this.recoveryMetrics;

    if (serviceId) {
      metrics = metrics.filter(m => m.serviceId === serviceId);
    }

    if (metrics.length === 0) return null;

    const totalDowntime = metrics.reduce((sum, m) => sum + m.downtime, 0);
    return totalDowntime / metrics.length;
  }

  calculateMTBF(serviceId = null) {
    let metrics = this.recoveryMetrics;

    if (serviceId) {
      metrics = metrics.filter(m => m.serviceId === serviceId);
    }

    if (metrics.length < 2) return null;

    const sortedByTime = metrics.sort((a, b) => 
      new Date(a.timestamp) - new Date(b.timestamp)
    );

    let totalTimeBetweenFailures = 0;
    for (let i = 1; i < sortedByTime.length; i++) {
      const timeBetween = new Date(sortedByTime[i].timestamp) - new Date(sortedByTime[i - 1].timestamp);
      totalTimeBetweenFailures += timeBetween;
    }

    return totalTimeBetweenFailures / (sortedByTime.length - 1);
  }

  calculateAvailability(serviceId = null) {
    let metrics = this.recoveryMetrics;

    if (serviceId) {
      metrics = metrics.filter(m => m.serviceId === serviceId);
    }

    if (metrics.length === 0) return 100;

    const totalDowntime = metrics.reduce((sum, m) => sum + m.downtime, 0);
    const totalTime = 24 * 60 * 60 * 1000; // 24 hours in ms

    return ((totalTime - totalDowntime) / totalTime) * 100;
  }

  getRecoveryReport(serviceId = null) {
    const mttr = this.calculateMTTR(serviceId);
    const mtbf = this.calculateMTBF(serviceId);
    const availability = this.calculateAvailability(serviceId);

    return {
      serviceId: serviceId || 'ALL',
      mttr: mttr ? Math.round(mttr) : null,
      mtbf: mtbf ? Math.round(mtbf) : null,
      availability: availability.toFixed(2),
      totalIncidents: this.recoveryMetrics.filter(m => !serviceId || m.serviceId === serviceId).length
    };
  }

  getMetrics() {
    return this.recoveryMetrics;
  }

  clearMetrics() {
    this.recoveryMetrics = [];
  }
}

export default new RecoveryTimeAnalyzer();
