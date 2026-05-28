/**
 * Monitoring and Alerting Testing (#99)
 * Test scenarios, alert delivery, accuracy, reliability, performance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MonitoringTestScenario,
  AlertTester,
  MonitoringAccuracyTester,
  MonitoringReliabilityTester,
  MonitoringPerformanceTester,
  MonitoringTestDocumentation,
  createMonitoringScenario,
  createAlertTester,
  createMonitoringAccuracyTester,
  createMonitoringReliabilityTester,
  createMonitoringPerformanceTester,
} from '../../testing/monitoring-testing.js';

// ── Monitoring Test Scenarios ─────────────────────────────────────────────────

describe('Monitoring Test Scenarios', () => {
  it('should create and run a monitoring scenario', async () => {
    const scenario = createMonitoringScenario('health-check', 'Verify health endpoint monitoring');
    scenario
      .addCheck('endpoint-reachable', async () => ({ status: 200 }), (r) => r.status === 200)
      .addCheck('response-time-ok', async () => 150, (ms) => ms < 1000);

    const results = await scenario.run();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should report failed checks in scenario', async () => {
    const scenario = createMonitoringScenario('failing-scenario', 'Test with failures');
    scenario
      .addCheck('ok-check', async () => true, (v) => v === true)
      .addCheck('failing-check', async () => false, (v) => v === true);

    const results = await scenario.run();
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });

  it('should handle check exceptions gracefully', async () => {
    const scenario = createMonitoringScenario('error-scenario', 'Test error handling');
    scenario.addCheck('throwing-check', async () => { throw new Error('Service unavailable'); });

    const results = await scenario.run();
    expect(results[0].passed).toBe(false);
    expect(results[0].error).toContain('Service unavailable');
  });

  it('should provide scenario summary', async () => {
    const scenario = createMonitoringScenario('summary-test', 'Summary test');
    scenario
      .addCheck('check-1', async () => true, (v) => v)
      .addCheck('check-2', async () => false, (v) => v);

    await scenario.run();
    const summary = scenario.getSummary();

    expect(summary.scenario).toBe('summary-test');
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it('should record check duration', async () => {
    const scenario = createMonitoringScenario('timing-test', 'Timing test');
    scenario.addCheck('timed-check', async () => true, (v) => v);

    const results = await scenario.run();
    expect(results[0].duration).toBeGreaterThanOrEqual(0);
  });
});

// ── Alert Testing ─────────────────────────────────────────────────────────────

describe('Alert Testing Procedures', () => {
  let alertTester;

  beforeEach(() => {
    alertTester = createAlertTester();
  });

  it('should verify alert fires when threshold is exceeded', async () => {
    const alertConfig = { name: 'high-error-rate', type: 'ERROR_RATE' };

    const result = await alertTester.testAlertTrigger(alertConfig, async (notify) => {
      // Simulate error rate exceeding threshold
      notify({ type: 'ERROR_RATE', severity: 'HIGH', message: 'Error rate 15% exceeds 5% threshold' });
    });

    expect(result.triggered).toBe(true);
    expect(result.matchesConfig).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('should detect missing alert (alert not firing when it should)', async () => {
    const alertConfig = { name: 'cpu-alert', type: 'CPU_HIGH' };

    const result = await alertTester.testAlertTrigger(alertConfig, async (notify) => {
      // Simulate: alert should fire but doesn't (bug)
      // notify is never called
    });

    expect(result.triggered).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('should detect false positives', async () => {
    const alertConfig = { name: 'memory-alert', type: 'MEMORY_HIGH' };

    const result = await alertTester.testNoFalsePositive(alertConfig, async (notify) => {
      // Normal conditions — alert should NOT fire
      // notify is never called
    });

    expect(result.falsePositives).toBe(0);
    expect(result.passed).toBe(true);
  });

  it('should flag false positive alerts', async () => {
    const alertConfig = { name: 'memory-alert', type: 'MEMORY_HIGH' };

    const result = await alertTester.testNoFalsePositive(alertConfig, async (notify) => {
      // Bug: alert fires under normal conditions
      notify({ type: 'MEMORY_HIGH', message: 'False positive' });
    });

    expect(result.falsePositives).toBe(1);
    expect(result.passed).toBe(false);
  });

  it('should measure alert delivery latency', async () => {
    let received = false;
    const result = await alertTester.measureDeliveryLatency(
      async () => { received = true; },
      async () => received,
      5000
    );

    expect(result.received).toBe(true);
    expect(result.withinThreshold).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should track delivery statistics', () => {
    alertTester.recordDelivery('alert-1', 'email', true, 120);
    alertTester.recordDelivery('alert-2', 'slack', true, 80);
    alertTester.recordDelivery('alert-3', 'pagerduty', false, 5000);

    const stats = alertTester.getDeliveryStats();
    expect(stats.total).toBe(3);
    expect(stats.successful).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.successRate).toBe('66.7%');
    expect(stats.avgLatency).toBeGreaterThan(0);
  });
});

// ── Monitoring Accuracy Testing ───────────────────────────────────────────────

describe('Monitoring Accuracy Testing', () => {
  let accuracyTester;

  beforeEach(() => {
    accuracyTester = createMonitoringAccuracyTester();
  });

  it('should validate metric within expected range', () => {
    const result = accuracyTester.testMetricAccuracy('response_time_ms', 250, { min: 0, max: 500 });
    expect(result.passed).toBe(true);
    expect(result.deviation).toBe(0);
  });

  it('should detect metric outside expected range', () => {
    const result = accuracyTester.testMetricAccuracy('response_time_ms', 750, { min: 0, max: 500 });
    expect(result.passed).toBe(false);
    expect(result.deviation).toBeGreaterThan(0);
  });

  it('should test health check accuracy across scenarios', async () => {
    const healthCheckFn = async (input) => ({ healthy: input.errorRate < 5 });
    const scenarios = [
      { name: 'healthy-service', input: { errorRate: 1 }, expectedHealthy: true },
      { name: 'degraded-service', input: { errorRate: 10 }, expectedHealthy: false },
    ];

    const results = await accuracyTester.testHealthCheckAccuracy(healthCheckFn, scenarios);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should detect inaccurate health check', async () => {
    // Health check that always returns healthy (bug)
    const buggyHealthCheck = async () => ({ healthy: true });
    const scenarios = [
      { name: 'should-be-unhealthy', input: { errorRate: 50 }, expectedHealthy: false },
    ];

    const results = await accuracyTester.testHealthCheckAccuracy(buggyHealthCheck, scenarios);
    expect(results[0].passed).toBe(false);
    expect(results[0].actual).toBe(true);
    expect(results[0].expected).toBe(false);
  });
});

// ── Monitoring Reliability Testing ───────────────────────────────────────────

describe('Monitoring Reliability Testing', () => {
  let reliabilityTester;

  beforeEach(() => {
    reliabilityTester = createMonitoringReliabilityTester();
  });

  it('should verify monitoring works reliably under repeated calls', async () => {
    let callCount = 0;
    const result = await reliabilityTester.testReliabilityUnderLoad(async () => {
      callCount++;
      return { status: 'ok' };
    }, 20);

    expect(result.iterations).toBe(20);
    expect(result.errors).toBe(0);
    expect(result.passed).toBe(true);
    expect(callCount).toBe(20);
  });

  it('should report errors during reliability test', async () => {
    let callCount = 0;
    const result = await reliabilityTester.testReliabilityUnderLoad(async () => {
      callCount++;
      if (callCount % 5 === 0) throw new Error('Intermittent failure');
    }, 10);

    expect(result.errors).toBeGreaterThan(0);
    expect(result.passed).toBe(false);
    expect(result.errorDetails.length).toBeGreaterThan(0);
  });

  it('should test monitoring recovery after failure', async () => {
    let isDown = false;
    const monitorFn = async () => {
      if (isDown) throw new Error('Service down');
      return { healthy: true };
    };

    const result = await reliabilityTester.testRecovery(
      monitorFn,
      async () => { isDown = true; },
      async () => { isDown = false; }
    );

    expect(result.beforeFailure.healthy).toBe(true);
    expect(result.duringFailure.error).toContain('Service down');
    expect(result.afterRecovery.healthy).toBe(true);
    expect(result.recovered).toBe(true);
  });
});

// ── Monitoring Performance Testing ───────────────────────────────────────────

describe('Monitoring Performance Testing', () => {
  let perfTester;

  beforeEach(() => {
    perfTester = createMonitoringPerformanceTester();
  });

  it('should benchmark monitoring check performance', async () => {
    const result = await perfTester.benchmarkMonitoringCheck(
      async () => ({ status: 'ok', latency: 5 }),
      1000, // max 1000ms
      5
    );

    expect(result.runs).toBe(5);
    expect(result.avgDuration).toBeGreaterThanOrEqual(0);
    expect(result.meetsThreshold).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('should fail benchmark when check exceeds threshold', async () => {
    const result = await perfTester.benchmarkMonitoringCheck(
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { status: 'ok' };
      },
      10, // max 10ms — will fail
      3
    );

    expect(result.passed).toBe(false);
    expect(result.meetsThreshold).toBe(false);
  });

  it('should report p95 duration', async () => {
    const result = await perfTester.benchmarkMonitoringCheck(
      async () => ({}),
      5000,
      10
    );

    expect(result.p95Duration).toBeDefined();
    expect(result.maxDuration).toBeGreaterThanOrEqual(result.avgDuration);
  });
});

// ── Monitoring Test Documentation ────────────────────────────────────────────

describe('Monitoring Test Documentation', () => {
  it('should generate markdown documentation', () => {
    const docs = new MonitoringTestDocumentation();
    docs
      .addTestCase(
        'Alert Trigger Test',
        'Verify alert fires when error rate exceeds threshold',
        ['Set error rate to 15%', 'Wait for alert evaluation window', 'Check alert was triggered'],
        'Alert fires within 60 seconds with severity HIGH'
      )
      .addTestCase(
        'False Positive Test',
        'Verify no alerts fire under normal conditions',
        ['Set error rate to 1%', 'Wait for evaluation window'],
        'No alerts are triggered'
      );

    const markdown = docs.generateMarkdown();
    expect(markdown).toContain('# Monitoring Test Documentation');
    expect(markdown).toContain('Alert Trigger Test');
    expect(markdown).toContain('False Positive Test');
    expect(markdown).toContain('**Steps:**');
    expect(markdown).toContain('**Expected:**');
  });
});
