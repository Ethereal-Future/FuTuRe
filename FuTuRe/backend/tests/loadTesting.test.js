import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  LoadTestScenario,
  PerformanceBaseline,
  LoadTestRunner,
  regressionTester,
  bottleneckAnalyzer,
  capacityPlanner,
  performanceAlerting,
  optimizationRecommender
} from '../src/loadTesting/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

async function cleanup() {
  try {
    await fs.rm(DATA_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
}

describe('Load Testing Framework', () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterEach(async () => {
    await cleanup();
  });

  describe('LoadTestScenario', () => {
    it('should create scenario', () => {
      const scenario = new LoadTestScenario('test', 'Test scenario');
      expect(scenario.name).toBe('test');
      expect(scenario.description).toBe('Test scenario');
    });

    it('should add requests', () => {
      const scenario = new LoadTestScenario('test', 'Test');
      scenario.addRequest('GET', '/api/health');
      scenario.addRequest('POST', '/api/stellar/account/create', {}, 2);
      
      expect(scenario.requests).toHaveLength(2);
      expect(scenario.requests[1].weight).toBe(2);
    });

    it('should configure scenario', () => {
      const scenario = new LoadTestScenario('test', 'Test');
      scenario.setDuration(120).setRampUp(20).setConcurrency(50);
      
      expect(scenario.duration).toBe(120);
      expect(scenario.rampUp).toBe(20);
      expect(scenario.concurrency).toBe(50);
    });

    it('should save and load scenario', async () => {
      const scenario = new LoadTestScenario('test', 'Test');
      scenario.addRequest('GET', '/api/health');
      await scenario.save();
      
      const loaded = await LoadTestScenario.load('test');
      expect(loaded.name).toBe('test');
      expect(loaded.requests).toHaveLength(1);
    });
  });

  describe('PerformanceBaseline', () => {
    it('should create baseline', () => {
      const baseline = new PerformanceBaseline('test');
      expect(baseline.name).toBe('test');
      expect(baseline.metrics.avgResponseTime).toBe(0);
    });

    it('should calculate metrics from results', () => {
      const baseline = new PerformanceBaseline('test');
      const results = [
        { responseTime: 100, success: true, timestamp: Date.now() },
        { responseTime: 200, success: true, timestamp: Date.now() + 100 },
        { responseTime: 300, success: false, timestamp: Date.now() + 200 }
      ];
      
      baseline.calculateFromResults(results);
      
      expect(baseline.metrics.avgResponseTime).toBe(200);
      expect(baseline.metrics.successCount).toBe(2);
      expect(baseline.metrics.errorCount).toBe(1);
    });

    it('should compare baselines', () => {
      const baseline1 = new PerformanceBaseline('test');
      baseline1.metrics.avgResponseTime = 100;
      baseline1.metrics.p95ResponseTime = 200;
      baseline1.metrics.errorRate = 1;
      baseline1.metrics.throughput = 100;
      
      const baseline2 = new PerformanceBaseline('test');
      baseline2.metrics.avgResponseTime = 110;
      baseline2.metrics.p95ResponseTime = 220;
      baseline2.metrics.errorRate = 1.5;
      baseline2.metrics.throughput = 95;
      
      const comparison = baseline1.compareWith(baseline2);
      expect(comparison.avgResponseTimeDiff).toBeDefined();
      expect(comparison.p95ResponseTimeDiff).toBeDefined();
    });
  });

  describe('RegressionTester', () => {
    it('should detect response time regression', () => {
      const baseline = new PerformanceBaseline('test');
      baseline.metrics.avgResponseTime = 100;
      baseline.metrics.p95ResponseTime = 200;
      baseline.metrics.errorRate = 1;
      baseline.metrics.throughput = 100;
      
      const current = {
        avgResponseTime: 150,
        p95ResponseTime: 200,
        errorRate: 1,
        throughput: 100
      };
      
      const regressions = regressionTester.detectRegression(current, baseline);
      expect(regressions.length).toBeGreaterThan(0);
    });

    it('should generate regression report', () => {
      const regressions = [
        { metric: 'avgResponseTime', severity: 'HIGH', message: 'Test' }
      ];
      
      const report = regressionTester.generateReport(regressions);
      expect(report.status).toBe('WARN');
    });
  });

  describe('BottleneckAnalyzer', () => {
    it('should identify bottlenecks', () => {
      const results = [
        { method: 'GET', path: '/api/health', responseTime: 100, success: true },
        { method: 'GET', path: '/api/health', responseTime: 150, success: true },
        { method: 'POST', path: '/api/stellar/payment/send', responseTime: 2000, success: false },
        { method: 'POST', path: '/api/stellar/payment/send', responseTime: 2100, success: false }
      ];
      
      const bottlenecks = bottleneckAnalyzer.analyze(results);
      expect(bottlenecks.length).toBeGreaterThan(0);
    });

    it('should get recommendations', () => {
      const bottlenecks = [
        { endpoint: 'POST /api/test', avgResponseTime: 1500, p95ResponseTime: 2000, errorRate: 10 }
      ];
      
      const recommendations = bottleneckAnalyzer.getRecommendations(bottlenecks);
      expect(recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('CapacityPlanner', () => {
    it('should calculate capacity', () => {
      const results = {
        avgResponseTime: 100,
        errorRate: 1,
        throughput: 100
      };
      
      const capacity = capacityPlanner.calculateCapacity(results);
      expect(capacity.maxCapacity).toBeDefined();
      expect(capacity.recommendations).toBeDefined();
    });

    it('should estimate scaling needs', () => {
      const scaling = capacityPlanner.estimateScalingNeeds(100, 0.2, 12);
      expect(scaling.projectedThroughput).toBeGreaterThan(scaling.currentThroughput);
      expect(scaling.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('PerformanceAlerting', () => {
    it('should check metrics and generate alerts', () => {
      const results = {
        avgResponseTime: 2000,
        p95ResponseTime: 3000,
        errorRate: 10,
        throughput: 5
      };
      
      const alerts = performanceAlerting.checkMetrics(results);
      expect(alerts.length).toBeGreaterThan(0);
    });

    it('should save alerts', async () => {
      const results = {
        avgResponseTime: 2000,
        p95ResponseTime: 3000,
        errorRate: 10,
        throughput: 5
      };
      
      performanceAlerting.checkMetrics(results);
      const file = await performanceAlerting.saveAlerts();
      expect(file).toBeDefined();
    });
  });

  describe('OptimizationRecommender', () => {
    it('should generate recommendations', () => {
      const results = {
        avgResponseTime: 1000,
        errorRate: 5,
        throughput: 50
      };
      
      const bottlenecks = [
        { endpoint: 'POST /api/test', avgResponseTime: 1500, errorRate: 10 }
      ];
      
      const recommendations = optimizationRecommender.generateRecommendations(results, bottlenecks);
      expect(recommendations.length).toBeGreaterThan(0);
    });

    it('should prioritize recommendations', () => {
      const recommendations = [
        { priority: 'LOW', message: 'Low priority' },
        { priority: 'CRITICAL', message: 'Critical' },
        { priority: 'HIGH', message: 'High' }
      ];
      
      const prioritized = optimizationRecommender.prioritizeRecommendations(recommendations);
      expect(prioritized[0].priority).toBe('CRITICAL');
    });
  });
});
