/**
 * Scalability Testing (#97)
 * Horizontal/vertical scaling, DB scaling, network, resource utilization, monitoring
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ScalabilityScenario,
  HorizontalScalingTester,
  VerticalScalingTester,
  DatabaseScalingTester,
  NetworkScalingTester,
  ResourceUtilizationTester,
  ScalabilityMonitor,
  createScalabilityScenario,
  createHorizontalScalingTester,
  createVerticalScalingTester,
  createDatabaseScalingTester,
  createNetworkScalingTester,
  createResourceUtilizationTester,
  createScalabilityMonitor,
} from '../../testing/scalability-testing.js';

// ── Scalability Scenarios ─────────────────────────────────────────────────────

describe('Scalability Test Scenarios', () => {
  it('should create and run a scalability scenario', async () => {
    const scenario = createScalabilityScenario('api-load', 'Test API under increasing load');
    scenario
      .addStep(10, 1000, async (i) => ({ requestId: i, status: 200 }))
      .addStep(50, 1000, async (i) => ({ requestId: i, status: 200 }));

    const results = await scenario.run();
    expect(results).toHaveLength(2);
    expect(results[0].concurrency).toBe(10);
    expect(results[1].concurrency).toBe(50);
    expect(results.every((r) => r.succeeded > 0)).toBe(true);
  });

  it('should calculate throughput per step', async () => {
    const scenario = createScalabilityScenario('throughput-test', 'Throughput test');
    scenario.addStep(20, 500, async () => ({ ok: true }));

    const results = await scenario.run();
    expect(results[0].throughput).toBeGreaterThan(0);
  });

  it('should report error rate per step', async () => {
    const scenario = createScalabilityScenario('error-rate-test', 'Error rate test');
    let count = 0;
    scenario.addStep(10, 500, async () => {
      count++;
      if (count % 2 === 0) throw new Error('Simulated failure');
      return { ok: true };
    });

    const results = await scenario.run();
    expect(parseFloat(results[0].errorRate)).toBeGreaterThan(0);
  });

  it('should provide scenario summary', async () => {
    const scenario = createScalabilityScenario('summary-test', 'Summary test');
    scenario
      .addStep(5, 200, async () => ({ ok: true }))
      .addStep(10, 200, async () => ({ ok: true }));

    await scenario.run();
    const summary = scenario.getSummary();

    expect(summary.scenario).toBe('summary-test');
    expect(summary.steps).toBe(2);
    expect(summary.maxThroughput).toBeGreaterThan(0);
  });
});

// ── Horizontal Scaling Testing ────────────────────────────────────────────────

describe('Horizontal Scaling Testing', () => {
  let tester;

  beforeEach(() => {
    tester = createHorizontalScalingTester();
  });

  it('should test linear scaling across instance counts', async () => {
    const results = await tester.testLinearScaling([1, 2, 4], async (i) => ({ instance: i, ok: true }));

    expect(results).toHaveLength(3);
    expect(results[0].instances).toBe(1);
    expect(results[1].instances).toBe(2);
    expect(results[2].instances).toBe(4);
    expect(results.every((r) => r.succeeded > 0)).toBe(true);
  });

  it('should calculate scaling factor', async () => {
    const results = await tester.testLinearScaling([1, 2], async () => ({ ok: true }));
    // First result has scalingFactor 1 (baseline)
    expect(results[0].scalingFactor).toBe(1);
    // Second result has a scaling factor
    expect(results[1].scalingFactor).toBeDefined();
  });

  it('should test load distribution across instances', () => {
    // Well-balanced distribution
    const balanced = tester.testLoadDistribution([100, 98, 102, 100]);
    expect(balanced.balanced).toBe(true);
    expect(balanced.passed).toBe(true);

    // Unbalanced distribution
    const unbalanced = tester.testLoadDistribution([200, 10, 190, 5]);
    expect(unbalanced.balanced).toBe(false);
    expect(unbalanced.passed).toBe(false);
  });

  it('should calculate average requests per instance', () => {
    const result = tester.testLoadDistribution([100, 100, 100, 100]);
    expect(result.avgPerInstance).toBe(100);
    expect(result.totalRequests).toBe(400);
  });
});

// ── Vertical Scaling Testing ──────────────────────────────────────────────────

describe('Vertical Scaling Testing', () => {
  let tester;

  beforeEach(() => {
    tester = createVerticalScalingTester();
  });

  it('should test performance improvement with more resources', async () => {
    const resourceLevels = [
      { name: '1-cpu', cpus: 1 },
      { name: '2-cpu', cpus: 2 },
      { name: '4-cpu', cpus: 4 },
    ];

    const result = await tester.testResourceScaling(resourceLevels, async (level) => ({
      processed: level.cpus * 100,
    }));

    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.passed)).toBe(true);
  });

  it('should find saturation point', () => {
    const results = [
      { level: '1-cpu', duration: 1000 },
      { level: '2-cpu', duration: 520 },
      { level: '4-cpu', duration: 510 }, // minimal improvement — saturation
      { level: '8-cpu', duration: 505 },
    ];

    const saturation = tester.findSaturationPoint(results);
    expect(saturation.saturationAt).toBeDefined();
  });

  it('should report no saturation when performance keeps improving', () => {
    const results = [
      { level: '1-cpu', duration: 1000 },
      { level: '2-cpu', duration: 500 },
      { level: '4-cpu', duration: 250 },
    ];

    const saturation = tester.findSaturationPoint(results);
    expect(saturation.saturationAt).toBeNull();
  });
});

// ── Database Scaling Testing ──────────────────────────────────────────────────

describe('Database Scaling Testing', () => {
  let tester;

  beforeEach(() => {
    tester = createDatabaseScalingTester();
  });

  it('should test connection pool scaling', async () => {
    const results = await tester.testConnectionPoolScaling(
      [5, 10, 20],
      async () => ({ rows: [{ id: 1 }] })
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.succeeded > 0)).toBe(true);
    expect(results[0].connections).toBe(5);
  });

  it('should report error rate under connection pressure', async () => {
    let count = 0;
    const results = await tester.testConnectionPoolScaling(
      [10],
      async () => {
        count++;
        if (count > 8) throw new Error('Connection pool exhausted');
        return { rows: [] };
      }
    );

    expect(results[0].failed).toBeGreaterThan(0);
  });

  it('should test read replica scaling', async () => {
    const results = await tester.testReadReplicaScaling(
      async () => ({ rows: [{ id: 1 }] }),
      async () => ({ affected: 1 }),
      [1, 2, 3]
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should report read/write success rates separately', async () => {
    const results = await tester.testReadReplicaScaling(
      async () => ({ rows: [] }),
      async () => ({ affected: 1 }),
      [1]
    );

    expect(results[0].readSuccessRate).toContain('%');
    expect(results[0].writeSuccessRate).toContain('%');
  });
});

// ── Network Scaling Testing ───────────────────────────────────────────────────

describe('Network Scaling Testing', () => {
  let tester;

  beforeEach(() => {
    tester = createNetworkScalingTester();
  });

  it('should test throughput at increasing request rates', async () => {
    const results = await tester.testThroughputScaling(
      [10, 20, 50],
      async () => ({ status: 200 })
    );

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.succeeded > 0)).toBe(true);
  });

  it('should mark step as passed when success rate >= 95%', async () => {
    const results = await tester.testThroughputScaling(
      [10],
      async () => ({ status: 200 })
    );

    expect(results[0].passed).toBe(true);
  });

  it('should find maximum sustainable RPS', async () => {
    const results = await tester.testThroughputScaling(
      [10, 20],
      async () => ({ status: 200 })
    );

    const maxRps = tester.findMaxSustainableRps(results);
    expect(maxRps.maxRps).toBeGreaterThan(0);
  });

  it('should return zero max RPS when no sustainable rate found', () => {
    const maxRps = tester.findMaxSustainableRps([
      { targetRps: 100, passed: false },
      { targetRps: 200, passed: false },
    ]);

    expect(maxRps.maxRps).toBe(0);
  });
});

// ── Resource Utilization Testing ──────────────────────────────────────────────

describe('Resource Utilization Testing', () => {
  it('should track resource utilization during workload', async () => {
    const tester = createResourceUtilizationTester();
    const result = await tester.trackUtilization(
      async () => {
        // Simulate some work
        await new Promise((r) => setTimeout(r, 50));
      },
      { cpu: 100, memory: 100 } // permissive thresholds for test
    );

    expect(result).toHaveProperty('avgCpu');
    expect(result).toHaveProperty('avgMemory');
    expect(result).toHaveProperty('maxCpu');
    expect(result).toHaveProperty('maxMemory');
  });

  it('should pass when utilization is within thresholds', async () => {
    const tester = createResourceUtilizationTester();
    const result = await tester.trackUtilization(
      async () => {},
      { cpu: 100, memory: 100 }
    );

    expect(result.passed).toBe(true);
  });
});

// ── Scalability Monitoring ────────────────────────────────────────────────────

describe('Scalability Monitoring', () => {
  let monitor;

  beforeEach(() => {
    monitor = createScalabilityMonitor();
  });

  it('should record scaling metrics', () => {
    monitor.record(10, 100, 0, 50);
    monitor.record(50, 450, 1, 55);
    monitor.record(100, 800, 2, 70);

    const curve = monitor.getScalingCurve();
    expect(curve).toHaveLength(3);
    expect(curve[0]).toEqual({ concurrency: 10, throughput: 100 });
  });

  it('should detect throughput degradation', () => {
    monitor.record(10, 100, 0, 50);
    monitor.record(50, 400, 1, 60);
    monitor.record(100, 200, 5, 200); // degradation at 100 concurrent

    const degradations = monitor.detectDegradation(0.2);
    expect(degradations.length).toBeGreaterThan(0);
    expect(degradations[0].at).toBe(100);
  });

  it('should not flag degradation within threshold', () => {
    monitor.record(10, 100, 0, 50);
    monitor.record(20, 195, 0, 52); // ~2.5% drop — within 20% threshold

    const degradations = monitor.detectDegradation(0.2);
    expect(degradations).toHaveLength(0);
  });

  it('should generate scaling recommendations', () => {
    monitor.record(10, 100, 0, 50);
    monitor.record(100, 50, 10, 1500); // degradation + high error rate + high latency

    const recommendations = monitor.generateRecommendations();
    expect(recommendations.length).toBeGreaterThan(0);
    expect(recommendations.some((r) => r.toLowerCase().includes('scale'))).toBe(true);
  });

  it('should recommend no action when scaling is healthy', () => {
    monitor.record(10, 100, 0, 50);
    monitor.record(20, 200, 0, 50);

    const recommendations = monitor.generateRecommendations();
    expect(recommendations[0]).toContain('scales well');
  });
});
