/**
 * Test Automation Pipeline (#100)
 * Orchestration, parallel execution, aggregation, failure analysis, dashboard
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TestPipelineOrchestrator,
  TestResultAggregator,
  FailureAnalyzer,
  PipelineDashboard,
  createPipelineOrchestrator,
  createResultAggregator,
  createFailureAnalyzer,
  createPipelineDashboard,
} from '../../testing/test-pipeline.js';

// ── Pipeline Orchestration ────────────────────────────────────────────────────

describe('Test Pipeline Orchestration', () => {
  it('should run stages sequentially', async () => {
    const order = [];
    const pipeline = createPipelineOrchestrator('Sequential Pipeline')
      .addStage('stage-1', async () => { order.push(1); return 'result-1'; })
      .addStage('stage-2', async () => { order.push(2); return 'result-2'; })
      .addStage('stage-3', async () => { order.push(3); return 'result-3'; });

    const report = await pipeline.run();

    expect(order).toEqual([1, 2, 3]);
    expect(report.status).toBe('PASS');
    expect(report.stages.total).toBe(3);
    expect(report.stages.passed).toBe(3);
  });

  it('should stop pipeline on stage failure by default', async () => {
    const executed = [];
    const pipeline = createPipelineOrchestrator('Failing Pipeline')
      .addStage('stage-1', async () => { executed.push('stage-1'); })
      .addStage('stage-2', async () => { executed.push('stage-2'); throw new Error('Stage 2 failed'); })
      .addStage('stage-3', async () => { executed.push('stage-3'); });

    const report = await pipeline.run();

    expect(executed).toContain('stage-1');
    expect(executed).toContain('stage-2');
    expect(executed).not.toContain('stage-3');
    expect(report.status).toBe('FAIL');
  });

  it('should continue pipeline when continueOnFailure is set', async () => {
    const executed = [];
    const pipeline = createPipelineOrchestrator('Resilient Pipeline')
      .addStage('stage-1', async () => { executed.push('stage-1'); })
      .addStage('stage-2', async () => { executed.push('stage-2'); throw new Error('Non-fatal'); }, { continueOnFailure: true })
      .addStage('stage-3', async () => { executed.push('stage-3'); });

    const report = await pipeline.run();

    expect(executed).toEqual(['stage-1', 'stage-2', 'stage-3']);
    expect(report.stages.failed).toBe(1);
    expect(report.stages.passed).toBe(2);
  });

  it('should run parallel stage groups concurrently', async () => {
    const pipeline = createPipelineOrchestrator('Parallel Pipeline');
    pipeline.addParallelStages([
      { name: 'unit-tests', runFn: async () => ({ tests: 50, passed: 50 }) },
      { name: 'lint', runFn: async () => ({ errors: 0 }) },
      { name: 'type-check', runFn: async () => ({ errors: 0 }) },
    ]);

    const report = await pipeline.run();
    expect(report.stages.total).toBe(3);
    expect(report.stages.passed).toBe(3);
  });

  it('should pass context between stages', async () => {
    const pipeline = createPipelineOrchestrator('Context Pipeline')
      .addStage('setup', async (ctx) => { ctx.dbReady = true; return { dbReady: true }; })
      .addStage('test', async (ctx) => {
        expect(ctx.setup).toBeDefined();
        return { ran: true };
      });

    const report = await pipeline.run();
    expect(report.status).toBe('PASS');
  });

  it('should call lifecycle hooks', async () => {
    const hookLog = [];
    const pipeline = createPipelineOrchestrator('Hooked Pipeline')
      .onBeforeAll(() => hookLog.push('beforeAll'))
      .onAfterAll(() => hookLog.push('afterAll'))
      .onBeforeStage(() => hookLog.push('beforeStage'))
      .onAfterStage(() => hookLog.push('afterStage'))
      .addStage('stage-1', async () => hookLog.push('stage'));

    await pipeline.run();

    expect(hookLog).toContain('beforeAll');
    expect(hookLog).toContain('afterAll');
    expect(hookLog).toContain('beforeStage');
    expect(hookLog).toContain('afterStage');
    expect(hookLog).toContain('stage');
  });

  it('should timeout a stage that takes too long', async () => {
    const pipeline = createPipelineOrchestrator('Timeout Pipeline')
      .addStage(
        'slow-stage',
        async () => new Promise((resolve) => setTimeout(resolve, 5000)),
        { timeout: 100, continueOnFailure: true }
      );

    const report = await pipeline.run();
    expect(report.stages.failed).toBe(1);
    expect(report.results[0].error).toContain('timed out');
  });

  it('should include timing in report', async () => {
    const pipeline = createPipelineOrchestrator('Timed Pipeline')
      .addStage('stage-1', async () => {});

    const report = await pipeline.run();
    expect(report.totalDuration).toBeGreaterThanOrEqual(0);
    expect(report.timestamp).toBeDefined();
  });
});

// ── Test Result Aggregation ───────────────────────────────────────────────────

describe('Test Result Aggregation', () => {
  let aggregator;

  beforeEach(() => {
    aggregator = createResultAggregator();
  });

  it('should aggregate results from multiple suites', () => {
    aggregator
      .addSuite('unit', [
        { name: 'test-1', passed: true, duration: 10 },
        { name: 'test-2', passed: true, duration: 15 },
      ])
      .addSuite('integration', [
        { name: 'test-3', passed: true, duration: 100 },
        { name: 'test-4', passed: false, duration: 50, error: 'Connection refused' },
      ]);

    const agg = aggregator.aggregate();
    expect(agg.total).toBe(4);
    expect(agg.passed).toBe(3);
    expect(agg.failed).toBe(1);
    expect(agg.suites).toBe(2);
    expect(agg.passRate).toBe('75.0%');
  });

  it('should list all failures', () => {
    aggregator.addSuite('tests', [
      { name: 'passing', passed: true },
      { name: 'failing', passed: false, error: 'Expected true to be false' },
    ]);

    const agg = aggregator.aggregate();
    expect(agg.failures).toHaveLength(1);
    expect(agg.failures[0].name).toBe('failing');
  });

  it('should generate valid JUnit XML', () => {
    aggregator.addSuite('unit', [
      { name: 'test-pass', passed: true, duration: 10 },
      { name: 'test-fail', passed: false, duration: 5, error: 'Assertion failed' },
    ]);

    const xml = aggregator.generateJUnitXML();
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<testsuites');
    expect(xml).toContain('test-pass');
    expect(xml).toContain('test-fail');
    expect(xml).toContain('<failure');
  });

  it('should calculate total duration', () => {
    aggregator.addSuite('tests', [
      { name: 't1', passed: true, duration: 100 },
      { name: 't2', passed: true, duration: 200 },
    ]);

    const agg = aggregator.aggregate();
    expect(agg.totalDuration).toBe(300);
  });
});

// ── Failure Analysis ──────────────────────────────────────────────────────────

describe('Test Failure Analysis', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = createFailureAnalyzer();
  });

  it('should return no patterns for empty failures', () => {
    const result = analyzer.analyze([]);
    expect(result.patterns).toHaveLength(0);
    expect(result.severity).toBe('NONE');
  });

  it('should detect timeout patterns', () => {
    const failures = [
      { name: 'test-1', error: 'Test timed out after 5000ms' },
      { name: 'test-2', error: 'Operation timeout exceeded' },
    ];

    const result = analyzer.analyze(failures);
    const timeoutPattern = result.patterns.find((p) => p.type === 'TIMEOUT');
    expect(timeoutPattern).toBeDefined();
    expect(timeoutPattern.count).toBe(2);
  });

  it('should detect network failure patterns', () => {
    const failures = [
      { name: 'test-1', error: 'ECONNREFUSED connection refused' },
      { name: 'test-2', error: 'Network error: fetch failed' },
    ];

    const result = analyzer.analyze(failures);
    const networkPattern = result.patterns.find((p) => p.type === 'NETWORK');
    expect(networkPattern).toBeDefined();
  });

  it('should detect assertion failure patterns', () => {
    const failures = [
      { name: 'test-1', error: 'expect(received).toBe(expected)' },
      { name: 'test-2', error: 'AssertionError: toEqual failed' },
    ];

    const result = analyzer.analyze(failures);
    const assertionPattern = result.patterns.find((p) => p.type === 'ASSERTION');
    expect(assertionPattern).toBeDefined();
  });

  it('should calculate severity based on failure count', () => {
    const manyFailures = Array.from({ length: 12 }, (_, i) => ({ name: `test-${i}`, error: 'failed' }));
    const fewFailures = [{ name: 'test-1', error: 'failed' }];

    expect(analyzer.analyze(manyFailures).severity).toBe('CRITICAL');
    expect(analyzer.analyze(fewFailures).severity).toBe('LOW');
  });

  it('should generate recommendations for detected patterns', () => {
    const failures = [{ name: 'test-1', error: 'timeout exceeded' }];
    const result = analyzer.analyze(failures);
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0]).toContain('timeout');
  });
});

// ── Pipeline Dashboard ────────────────────────────────────────────────────────

describe('Test Pipeline Dashboard', () => {
  let dashboard;

  beforeEach(() => {
    dashboard = createPipelineDashboard();
  });

  it('should record pipeline runs', () => {
    dashboard.recordRun({ status: 'PASS', totalDuration: 1000, stages: { passed: 5, failed: 0 }, timestamp: new Date().toISOString() });
    dashboard.recordRun({ status: 'FAIL', totalDuration: 800, stages: { passed: 4, failed: 1 }, timestamp: new Date().toISOString() });

    const stats = dashboard.getStats();
    expect(stats.totalRuns).toBe(2);
    expect(stats.lastStatus).toBe('FAIL');
  });

  it('should calculate pass rate across runs', () => {
    for (let i = 0; i < 4; i++) {
      dashboard.recordRun({ status: 'PASS', totalDuration: 500, stages: { passed: 3, failed: 0 }, timestamp: new Date().toISOString() });
    }
    dashboard.recordRun({ status: 'FAIL', totalDuration: 500, stages: { passed: 2, failed: 1 }, timestamp: new Date().toISOString() });

    const stats = dashboard.getStats();
    expect(stats.passRate).toBe('80.0%');
  });

  it('should return trend data', () => {
    for (let i = 0; i < 5; i++) {
      dashboard.recordRun({ status: 'PASS', totalDuration: 1000 + i * 100, stages: { passed: 3, failed: 0 }, timestamp: new Date().toISOString() });
    }

    const trend = dashboard.getTrend(3);
    expect(trend).toHaveLength(3);
    expect(trend[0]).toHaveProperty('status');
    expect(trend[0]).toHaveProperty('duration');
  });

  it('should return empty stats for no runs', () => {
    const stats = dashboard.getStats();
    expect(stats.totalRuns).toBe(0);
    expect(stats.passRate).toBe('0%');
  });

  it('should integrate with pipeline orchestrator', async () => {
    const pipeline = createPipelineOrchestrator('CI Pipeline')
      .addStage('build', async () => ({ artifacts: 3 }))
      .addStage('test', async () => ({ passed: 42 }));

    const report = await pipeline.run();
    dashboard.recordRun(report);

    const stats = dashboard.getStats();
    expect(stats.totalRuns).toBe(1);
    expect(stats.lastStatus).toBe('PASS');
  });
});
