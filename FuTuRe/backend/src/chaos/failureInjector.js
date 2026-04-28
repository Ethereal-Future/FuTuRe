class FailureInjector {
  constructor() {
    this.injections = new Map();
    this.activeFailures = new Set();
  }

  injectLatency(targetId, delayMs, probability = 1.0) {
    const injection = {
      type: 'LATENCY',
      targetId,
      delayMs,
      probability,
      startTime: Date.now(),
      enabled: true
    };

    this.injections.set(`latency-${targetId}`, injection);
    this.activeFailures.add(`latency-${targetId}`);
    return injection;
  }

  injectError(targetId, errorRate, errorCode = 500, probability = 1.0) {
    const injection = {
      type: 'ERROR',
      targetId,
      errorRate,
      errorCode,
      probability,
      startTime: Date.now(),
      enabled: true,
      errorCount: 0
    };

    this.injections.set(`error-${targetId}`, injection);
    this.activeFailures.add(`error-${targetId}`);
    return injection;
  }

  injectPacketLoss(targetId, lossRate, probability = 1.0) {
    const injection = {
      type: 'PACKET_LOSS',
      targetId,
      lossRate,
      probability,
      startTime: Date.now(),
      enabled: true,
      droppedPackets: 0
    };

    this.injections.set(`packet-loss-${targetId}`, injection);
    this.activeFailures.add(`packet-loss-${targetId}`);
    return injection;
  }

  injectCpuSpike(targetId, cpuUsage, durationMs) {
    const injection = {
      type: 'CPU_SPIKE',
      targetId,
      cpuUsage,
      durationMs,
      startTime: Date.now(),
      enabled: true
    };

    this.injections.set(`cpu-spike-${targetId}`, injection);
    this.activeFailures.add(`cpu-spike-${targetId}`);

    setTimeout(() => {
      this.removeInjection(`cpu-spike-${targetId}`);
    }, durationMs);

    return injection;
  }

  injectMemoryLeak(targetId, leakRateMb) {
    const injection = {
      type: 'MEMORY_LEAK',
      targetId,
      leakRateMb,
      startTime: Date.now(),
      enabled: true,
      totalLeaked: 0
    };

    this.injections.set(`memory-leak-${targetId}`, injection);
    this.activeFailures.add(`memory-leak-${targetId}`);
    return injection;
  }

  shouldInject(injectionId) {
    const injection = this.injections.get(injectionId);
    if (!injection || !injection.enabled) return false;
    return Math.random() < injection.probability;
  }

  getInjection(injectionId) {
    return this.injections.get(injectionId);
  }

  removeInjection(injectionId) {
    this.injections.delete(injectionId);
    this.activeFailures.delete(injectionId);
  }

  removeAllInjections() {
    this.injections.clear();
    this.activeFailures.clear();
  }

  getActiveFailures() {
    return Array.from(this.activeFailures).map(id => this.injections.get(id));
  }

  disableInjection(injectionId) {
    const injection = this.injections.get(injectionId);
    if (injection) {
      injection.enabled = false;
    }
  }

  enableInjection(injectionId) {
    const injection = this.injections.get(injectionId);
    if (injection) {
      injection.enabled = true;
    }
  }
}

export default new FailureInjector();
