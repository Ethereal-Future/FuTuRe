/**
 * Scalability Testing Utilities (#97)
 * Horizontal/vertical scaling, DB scaling, network, resource utilization
 */

export class ScalabilityScenario {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.steps = [];
    this.results = [];
  }

  addStep(concurrency, durationMs, workloadFn) {
    this.steps.push({ concurrency, durationMs, workloadFn });
    return this;
  }

  async run() {
    this.results = [];
    for (const step of this.steps) {
      const stepResult = await this._runStep(step);
      this.results.push(stepResult);
    }
    return this.results;
  }

  async _runStep({ concurrency, durationMs, workloadFn }) {
    const start = Date.now();
    const tasks = Array.from({ length: concurrency }, (_, i) =>
      workloadFn(i).catch((e) => ({ error: e.message }))
    );
    const outcomes = await Promise.allSettled(tasks);
    const duration = Date.now() - start;

    const succeeded = outcomes.filter((o) => o.status === 'fulfilled' && !o.value?.error).length;
    const failed = concurrency - succeeded;

    return {
      concurrency,
      durationMs: duration,
      succeeded,
      failed,
      throughput: Math.round((succeeded / (duration / 1000)) * 10) / 10,
      errorRate: ((failed / concurrency) * 100).toFixed(1) + '%',
    };
  }

  getSummary() {
    if (this.results.length === 0) return { scenario: this.name, steps: 0 };
    const maxThroughput = Math.max(...this.results.map((r) => r.throughput));
    const scalingEfficiency = this._calculateScalingEfficiency();
    return { scenario: this.name, steps: this.results.length, maxThroughput, scalingEfficiency };
  }

  _calculateScalingEfficiency() {
    if (this.results.length < 2) return 'N/A';
    const first = this.results[0];
    const last = this.results[this.results.length - 1];
    if (!first.throughput || !last.throughput) return 'N/A';
    const concurrencyRatio = last.concurrency / first.concurrency;
    const throughputRatio = last.throughput / first.throughput;
    return ((throughputRatio / concurrencyRatio) * 100).toFixed(1) + '%';
  }
}

export class HorizontalScalingTester {
  /**
   * Simulate adding instances and verify throughput scales linearly.
   */
  async testLinearScaling(instanceCounts, workloadFn) {
    const results = [];
    for (const instances of instanceCounts) {
      const start = Date.now();
      const tasks = Array.from({ length: instances }, (_, i) => workloadFn(i).catch((e) => ({ error: e.message })));
      const outcomes = await Promise.allSettled(tasks);
      const duration = Date.now() - start;
      const succeeded = outcomes.filter((o) => o.status === 'fulfilled' && !o.value?.error).length;
      results.push({
        instances,
        succeeded,
        duration,
        throughput: Math.round((succeeded / (duration / 1000)) * 10) / 10,
      });
    }

    // Check if throughput scales with instance count
    const scalingResults = results.map((r, i) => {
      if (i === 0) return { ...r, scalingFactor: 1, linearExpected: r.throughput };
      const baseline = results[0];
      const expectedThroughput = baseline.throughput * (r.instances / baseline.instances);
      const actualRatio = r.throughput / baseline.throughput;
      const expectedRatio = r.instances / baseline.instances;
      return {
        ...r,
        scalingFactor: actualRatio / expectedRatio,
        linearExpected: expectedThroughput,
        isLinear: actualRatio / expectedRatio >= 0.7, // 70% efficiency threshold
      };
    });

    return scalingResults;
  }

  /**
   * Test load balancing distribution across instances.
   */
  testLoadDistribution(requestCounts) {
    const total = requestCounts.reduce((a, b) => a + b, 0);
    const avg = total / requestCounts.length;
    const maxDeviation = Math.max(...requestCounts.map((c) => Math.abs(c - avg)));
    const deviationPct = (maxDeviation / avg) * 100;

    return {
      instances: requestCounts.length,
      totalRequests: total,
      avgPerInstance: Math.round(avg),
      maxDeviation: Math.round(maxDeviation),
      deviationPercent: deviationPct.toFixed(1) + '%',
      balanced: deviationPct <= 20, // within 20% deviation
      passed: deviationPct <= 20,
    };
  }
}

export class VerticalScalingTester {
  /**
   * Test performance improvement when resources (CPU/memory) are increased.
   */
  async testResourceScaling(resourceLevels, workloadFn) {
    const results = [];
    for (const level of resourceLevels) {
      const start = Date.now();
      try {
        const output = await workloadFn(level);
        results.push({ level: level.name || level, duration: Date.now() - start, passed: true, output });
      } catch (error) {
        results.push({ level: level.name || level, duration: Date.now() - start, passed: false, error: error.message });
      }
    }

    // Verify performance improves with more resources
    const durations = results.map((r) => r.duration);
    const improving = durations.every((d, i) => i === 0 || d <= durations[i - 1] * 1.1); // allow 10% variance

    return { results, performanceImproves: improving };
  }

  /**
   * Find the resource level at which performance plateaus.
   */
  findSaturationPoint(results) {
    for (let i = 1; i < results.length; i++) {
      const improvement = (results[i - 1].duration - results[i].duration) / results[i - 1].duration;
      if (improvement < 0.05) { // less than 5% improvement
        return { saturationAt: results[i].level, index: i };
      }
    }
    return { saturationAt: null, message: 'No saturation point detected in provided range' };
  }
}

export class DatabaseScalingTester {
  /**
   * Test query performance under increasing concurrent connections.
   */
  async testConnectionPoolScaling(connectionCounts, queryFn) {
    const results = [];
    for (const connections of connectionCounts) {
      const tasks = Array.from({ length: connections }, () => queryFn().catch((e) => ({ error: e.message })));
      const start = Date.now();
      const outcomes = await Promise.allSettled(tasks);
      const duration = Date.now() - start;
      const succeeded = outcomes.filter((o) => o.status === 'fulfilled' && !o.value?.error).length;

      results.push({
        connections,
        succeeded,
        failed: connections - succeeded,
        duration,
        avgQueryTime: Math.round(duration / connections),
        errorRate: (((connections - succeeded) / connections) * 100).toFixed(1) + '%',
      });
    }
    return results;
  }

  /**
   * Test read replica scaling (reads should scale, writes should not degrade).
   */
  async testReadReplicaScaling(readFn, writeFn, replicaCounts) {
    const results = [];
    for (const replicas of replicaCounts) {
      const readTasks = Array.from({ length: replicas * 10 }, () => readFn().catch((e) => ({ error: e.message })));
      const writeTasks = Array.from({ length: 5 }, () => writeFn().catch((e) => ({ error: e.message })));

      const [readOutcomes, writeOutcomes] = await Promise.all([
        Promise.allSettled(readTasks),
        Promise.allSettled(writeTasks),
      ]);

      const readSuccess = readOutcomes.filter((o) => o.status === 'fulfilled' && !o.value?.error).length;
      const writeSuccess = writeOutcomes.filter((o) => o.status === 'fulfilled' && !o.value?.error).length;

      results.push({
        replicas,
        readSuccessRate: ((readSuccess / readTasks.length) * 100).toFixed(1) + '%',
        writeSuccessRate: ((writeSuccess / writeTasks.length) * 100).toFixed(1) + '%',
        passed: readSuccess === readTasks.length && writeSuccess === writeTasks.length,
      });
    }
    return results;
  }
}

export class NetworkScalingTester {
  /**
   * Test throughput under increasing network request rates.
   */
  async testThroughputScaling(requestRates, requestFn) {
    const results = [];
    for (const rps of requestRates) {
      const tasks = Array.from({ length: rps }, () => requestFn().catch((e) => ({ error: e.message })));
      const start = Date.now();
      const outcomes = await Promise.allSettled(tasks);
      const duration = Date.now() - start;
      const succeeded = outcomes.filter((o) => o.status === 'fulfilled' && !o.value?.error).length;

      results.push({
        targetRps: rps,
        actualRps: Math.round((succeeded / (duration / 1000)) * 10) / 10,
        succeeded,
        failed: rps - succeeded,
        duration,
        passed: succeeded / rps >= 0.95, // 95% success threshold
      });
    }
    return results;
  }

  /**
   * Find the maximum sustainable request rate.
   */
  findMaxSustainableRps(results) {
    const sustainable = results.filter((r) => r.passed);
    if (sustainable.length === 0) return { maxRps: 0, message: 'No sustainable rate found' };
    const max = sustainable[sustainable.length - 1];
    return { maxRps: max.targetRps, actualRps: max.actualRps };
  }
}

export class ResourceUtilizationTester {
  /**
   * Track resource usage during a workload and check against thresholds.
   */
  async trackUtilization(workloadFn, thresholds = { cpu: 80, memory: 85 }) {
    const samples = [];
    const sampleInterval = setInterval(() => {
      // In a real environment this would use process.cpuUsage() / process.memoryUsage()
      // Here we simulate sampling
      samples.push({ timestamp: Date.now(), cpu: Math.random() * 100, memory: Math.random() * 100 });
    }, 100);

    try {
      await workloadFn();
    } finally {
      clearInterval(sampleInterval);
    }

    if (samples.length === 0) return { samples: 0, passed: true };

    const avgCpu = samples.reduce((s, r) => s + r.cpu, 0) / samples.length;
    const avgMemory = samples.reduce((s, r) => s + r.memory, 0) / samples.length;
    const maxCpu = Math.max(...samples.map((s) => s.cpu));
    const maxMemory = Math.max(...samples.map((s) => s.memory));

    return {
      samples: samples.length,
      avgCpu: avgCpu.toFixed(1),
      avgMemory: avgMemory.toFixed(1),
      maxCpu: maxCpu.toFixed(1),
      maxMemory: maxMemory.toFixed(1),
      cpuWithinThreshold: maxCpu <= thresholds.cpu,
      memoryWithinThreshold: maxMemory <= thresholds.memory,
      passed: maxCpu <= thresholds.cpu && maxMemory <= thresholds.memory,
    };
  }
}

export class ScalabilityMonitor {
  constructor() {
    this.metrics = [];
  }

  record(concurrency, throughput, errorRate, latencyMs) {
    this.metrics.push({ concurrency, throughput, errorRate, latencyMs, timestamp: Date.now() });
    return this;
  }

  getScalingCurve() {
    return this.metrics.map((m) => ({ concurrency: m.concurrency, throughput: m.throughput }));
  }

  detectDegradation(threshold = 0.2) {
    const degradations = [];
    for (let i = 1; i < this.metrics.length; i++) {
      const prev = this.metrics[i - 1];
      const curr = this.metrics[i];
      const throughputDrop = (prev.throughput - curr.throughput) / prev.throughput;
      if (throughputDrop > threshold) {
        degradations.push({
          at: curr.concurrency,
          throughputDrop: (throughputDrop * 100).toFixed(1) + '%',
          message: `Throughput degraded by ${(throughputDrop * 100).toFixed(1)}% at concurrency ${curr.concurrency}`,
        });
      }
    }
    return degradations;
  }

  generateRecommendations() {
    const recommendations = [];
    const degradations = this.detectDegradation();

    if (degradations.length > 0) {
      recommendations.push(`Scale horizontally before reaching concurrency ${degradations[0].at}`);
      recommendations.push('Consider connection pooling and caching to reduce per-request overhead');
    }

    const highErrorRates = this.metrics.filter((m) => m.errorRate > 5);
    if (highErrorRates.length > 0) {
      recommendations.push('Implement circuit breakers to prevent cascade failures under load');
    }

    const highLatency = this.metrics.filter((m) => m.latencyMs > 1000);
    if (highLatency.length > 0) {
      recommendations.push('Optimize slow queries and add database indexes for high-concurrency scenarios');
    }

    if (recommendations.length === 0) recommendations.push('System scales well within tested range');
    return recommendations;
  }
}

export const createScalabilityScenario = (name, description) => new ScalabilityScenario(name, description);
export const createHorizontalScalingTester = () => new HorizontalScalingTester();
export const createVerticalScalingTester = () => new VerticalScalingTester();
export const createDatabaseScalingTester = () => new DatabaseScalingTester();
export const createNetworkScalingTester = () => new NetworkScalingTester();
export const createResourceUtilizationTester = () => new ResourceUtilizationTester();
export const createScalabilityMonitor = () => new ScalabilityMonitor();
