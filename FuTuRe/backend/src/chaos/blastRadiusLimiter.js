class BlastRadiusLimiter {
  constructor() {
    this.limits = new Map();
    this.impacts = new Map();
  }

  setLimit(limitId, maxAffectedServices, maxErrorRate = 10, maxDowntime = 60000) {
    const limit = {
      limitId,
      maxAffectedServices,
      maxErrorRate,
      maxDowntime,
      enabled: true
    };

    this.limits.set(limitId, limit);
    return limit;
  }

  canInjectFailure(failureId, affectedServices, estimatedErrorRate) {
    for (const [limitId, limit] of this.limits) {
      if (!limit.enabled) continue;

      if (affectedServices.length > limit.maxAffectedServices) {
        return {
          allowed: false,
          reason: `Affected services (${affectedServices.length}) exceeds limit (${limit.maxAffectedServices})`,
          limitId
        };
      }

      if (estimatedErrorRate > limit.maxErrorRate) {
        return {
          allowed: false,
          reason: `Error rate (${estimatedErrorRate}%) exceeds limit (${limit.maxErrorRate}%)`,
          limitId
        };
      }
    }

    return { allowed: true };
  }

  recordImpact(failureId, affectedServices, errorRate, downtime) {
    const impact = {
      failureId,
      affectedServices,
      errorRate,
      downtime,
      timestamp: new Date().toISOString(),
      withinLimits: true
    };

    for (const limit of this.limits.values()) {
      if (affectedServices.length > limit.maxAffectedServices ||
          errorRate > limit.maxErrorRate ||
          downtime > limit.maxDowntime) {
        impact.withinLimits = false;
        break;
      }
    }

    this.impacts.set(failureId, impact);
    return impact;
  }

  getImpactReport(failureId) {
    return this.impacts.get(failureId);
  }

  getAllImpacts() {
    return Array.from(this.impacts.values());
  }

  getOutOfBoundsImpacts() {
    return Array.from(this.impacts.values()).filter(i => !i.withinLimits);
  }

  disableLimit(limitId) {
    const limit = this.limits.get(limitId);
    if (limit) {
      limit.enabled = false;
    }
  }

  enableLimit(limitId) {
    const limit = this.limits.get(limitId);
    if (limit) {
      limit.enabled = true;
    }
  }
}

export default new BlastRadiusLimiter();
