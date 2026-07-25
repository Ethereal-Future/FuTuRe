/**
 * Monitoring and Alerting Testing Utilities (#99)
 * Test scenarios, alert delivery, accuracy, reliability, and performance
 */

export class MonitoringTestScenario {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.checks = [];
    this.results = [];
  }

  addCheck(name, checkFn, expectedOutcome) {
    this.checks.push({ name, checkFn, expectedOutcome });
    return this;
  }

  async run() {
    this.results = [];
    for (const check of this.checks) {
      const start = Date.now();
      try {
        const actual = await check.checkFn();
        const passed = check.expectedOutcome ? check.expectedOutcome(actual) : !!actual;
        this.results.push({ name: check.name, passed, actual, duration: Date.now() - start });
      } catch (error) {
        this.results.push({ name: check.name, passed: false, error: error.message, duration: Date.now() - start });
      }
    }
    return this.results;
  }

  getSummary() {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    return { scenario: this.name, total, passed, failed: total - passed };
  }
}

export class AlertTester {
  constructor() {
    this.alerts = [];
    this.deliveryLog = [];
  }

  /**
   * Simulate triggering an alert and verify it fires correctly.
   */
  async testAlertTrigger(alertConfig, triggerFn) {
    const firedAlerts = [];
    const mockNotify = (alert) => firedAlerts.push({ ...alert, firedAt: Date.now() });

    try {
      await triggerFn(mockNotify);
      const triggered = firedAlerts.length > 0;
      const matchesConfig = triggered && firedAlerts.some((a) => a.type === alertConfig.type);
      return {
        alertName: alertConfig.name,
        triggered,
        matchesConfig,
        passed: triggered && matchesConfig,
        firedAlerts,
      };
    } catch (error) {
      return { alertName: alertConfig.name, triggered: false, passed: false, error: error.message };
    }
  }

  /**
   * Test that an alert does NOT fire when conditions are normal (no false positives).
   */
  async testNoFalsePositive(alertConfig, normalConditionFn) {
    const firedAlerts = [];
    const mockNotify = (alert) => firedAlerts.push(alert);

    await normalConditionFn(mockNotify);
    return {
      alertName: alertConfig.name,
      falsePositives: firedAlerts.length,
      passed: firedAlerts.length === 0,
    };
  }

  /**
   * Measure alert delivery latency.
   */
  async measureDeliveryLatency(sendFn, receiveFn, maxLatencyMs = 5000) {
    const sentAt = Date.now();
    await sendFn();
    const received = await receiveFn();
    const latency = Date.now() - sentAt;
    return {
      latencyMs: latency,
      received: !!received,
      withinThreshold: latency <= maxLatencyMs,
      passed: !!received && latency <= maxLatencyMs,
    };
  }

  recordDelivery(alertId, channel, success, latencyMs) {
    this.deliveryLog.push({ alertId, channel, success, latencyMs, timestamp: new Date().toISOString() });
  }

  getDeliveryStats() {
    const total = this.deliveryLog.length;
    if (total === 0) return { total: 0, successRate: '0%', avgLatency: 0 };
    const successful = this.deliveryLog.filter((d) => d.success).length;
    const avgLatency = this.deliveryLog.reduce((sum, d) => sum + (d.latencyMs || 0), 0) / total;
    return {
      total,
      successful,
      failed: total - successful,
      successRate: ((successful / total) * 100).toFixed(1) + '%',
      avgLatency: Math.round(avgLatency),
    };
  }
}

export class MonitoringAccuracyTester {
  /**
   * Test that a metric collector returns values within expected range.
   */
  testMetricAccuracy(metricName, collectedValue, expectedRange) {
    const { min, max } = expectedRange;
    const inRange = collectedValue >= min && collectedValue <= max;
    return {
      metric: metricName,
      collected: collectedValue,
      expectedRange,
      passed: inRange,
      deviation: inRange ? 0 : Math.min(Math.abs(collectedValue - min), Math.abs(collectedValue - max)),
    };
  }

  /**
   * Verify that a health check correctly identifies healthy vs unhealthy states.
   */
  async testHealthCheckAccuracy(healthCheckFn, scenarios) {
    const results = [];
    for (const scenario of scenarios) {
      try {
        const result = await healthCheckFn(scenario.input);
        const correct = result.healthy === scenario.expectedHealthy;
        results.push({ scenario: scenario.name, expected: scenario.expectedHealthy, actual: result.healthy, passed: correct });
      } catch (error) {
        results.push({ scenario: scenario.name, passed: false, error: error.message });
      }
    }
    return results;
  }
}

export class MonitoringReliabilityTester {
  /**
   * Test that monitoring continues to work under repeated calls (no memory leaks, no crashes).
   */
  async testReliabilityUnderLoad(monitorFn, iterations = 100) {
    const errors = [];
    const durations = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      try {
        await monitorFn(i);
        durations.push(Date.now() - start);
      } catch (error) {
        errors.push({ iteration: i, error: error.message });
      }
    }

    const avgDuration = durations.reduce((a, b) => a + b, 0) / (durations.length || 1);
    return {
      iterations,
      errors: errors.length,
      errorRate: ((errors.length / iterations) * 100).toFixed(1) + '%',
      avgDuration: Math.round(avgDuration),
      passed: errors.length === 0,
      errorDetails: errors,
    };
  }

  /**
   * Test monitoring recovery after a simulated failure.
   */
  async testRecovery(monitorFn, failFn, recoverFn) {
    const beforeFailure = await monitorFn();
    await failFn();
    const duringFailure = await monitorFn().catch((e) => ({ error: e.message }));
    await recoverFn();
    const afterRecovery = await monitorFn();

    return {
      beforeFailure,
      duringFailure,
      afterRecovery,
      recovered: !afterRecovery.error && afterRecovery.healthy !== false,
    };
  }
}

export class MonitoringPerformanceTester {
  /**
   * Measure how long monitoring checks take and verify they meet SLA.
   */
  async benchmarkMonitoringCheck(checkFn, maxDurationMs = 1000, runs = 10) {
    const durations = [];
    for (let i = 0; i < runs; i++) {
      const start = Date.now();
      await checkFn();
      durations.push(Date.now() - start);
    }

    const avg = durations.reduce((a, b) => a + b, 0) / runs;
    const max = Math.max(...durations);
    const p95 = durations.sort((a, b) => a - b)[Math.floor(runs * 0.95)] || max;

    return {
      runs,
      avgDuration: Math.round(avg),
      maxDuration: max,
      p95Duration: p95,
      meetsThreshold: avg <= maxDurationMs,
      passed: avg <= maxDurationMs,
    };
  }
}

export class MonitoringTestDocumentation {
  constructor() {
    this.testCases = [];
  }

  addTestCase(name, description, steps, expectedResult) {
    this.testCases.push({ name, description, steps, expectedResult, addedAt: new Date().toISOString() });
    return this;
  }

  generateMarkdown() {
    const cases = this.testCases
      .map(
        (tc) => `### ${tc.name}\n${tc.description}\n\n**Steps:**\n${tc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n**Expected:** ${tc.expectedResult}`
      )
      .join('\n\n---\n\n');
    return `# Monitoring Test Documentation\n\nGenerated: ${new Date().toISOString()}\n\n${cases}`;
  }
}

export const createMonitoringScenario = (name, description) => new MonitoringTestScenario(name, description);
export const createAlertTester = () => new AlertTester();
export const createMonitoringAccuracyTester = () => new MonitoringAccuracyTester();
export const createMonitoringReliabilityTester = () => new MonitoringReliabilityTester();
export const createMonitoringPerformanceTester = () => new MonitoringPerformanceTester();
