class ServiceFailureSimulator {
  constructor() {
    this.failedServices = new Map();
    this.recoveryStrategies = new Map();
  }

  failService(serviceId, failureType = 'CRASH', recoveryTime = null) {
    const failure = {
      serviceId,
      failureType,
      startTime: Date.now(),
      recoveryTime,
      enabled: true,
      requestsRejected: 0,
      downtime: 0
    };

    this.failedServices.set(serviceId, failure);

    if (recoveryTime) {
      setTimeout(() => {
        this.recoverService(serviceId);
      }, recoveryTime);
    }

    return failure;
  }

  isServiceFailed(serviceId) {
    const failure = this.failedServices.get(serviceId);
    return failure && failure.enabled;
  }

  recoverService(serviceId) {
    const failure = this.failedServices.get(serviceId);
    if (failure) {
      failure.enabled = false;
      failure.downtime = Date.now() - failure.startTime;
    }
  }

  setRecoveryStrategy(serviceId, strategy) {
    this.recoveryStrategies.set(serviceId, strategy);
  }

  getRecoveryStrategy(serviceId) {
    return this.recoveryStrategies.get(serviceId);
  }

  getFailureStats(serviceId) {
    const failure = this.failedServices.get(serviceId);
    if (!failure) return null;

    return {
      serviceId,
      failureType: failure.failureType,
      duration: failure.enabled ? Date.now() - failure.startTime : failure.downtime,
      requestsRejected: failure.requestsRejected,
      status: failure.enabled ? 'FAILED' : 'RECOVERED'
    };
  }

  getAllFailures() {
    return Array.from(this.failedServices.values());
  }

  removeFailure(serviceId) {
    this.failedServices.delete(serviceId);
    this.recoveryStrategies.delete(serviceId);
  }

  recordRejectedRequest(serviceId) {
    const failure = this.failedServices.get(serviceId);
    if (failure) {
      failure.requestsRejected++;
    }
  }
}

export default new ServiceFailureSimulator();
