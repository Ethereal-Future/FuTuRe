/**
 * Test Automation Pipeline Utilities (#100)
 * Orchestration, parallel execution, aggregation, failure analysis, reporting
 */

export class PipelineStage {
  constructor(name, runFn, options = {}) {
    this.name = name;
    this.runFn = runFn;
    this.parallel = options.parallel || false;
    this.continueOnFailure = options.continueOnFailure || false;
    this.timeout = options.timeout || 300000; // 5 min default
    this.result = null;
  }

  async execute(context) {
    const start = Date.now();
    try {
      const result = await Promise.race([
        this.runFn(context),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Stage "${this.name}" timed out after ${this.timeout}ms`)), this.timeout)
        ),
      ]);
      this.result = { name: this.name, passed: true, duration: Date.now() - start, output: result };
    } catch (error) {
      this.result = { name: this.name, passed: false, duration: Date.now() - start, error: error.message };
      if (!this.continueOnFailure) throw error;
    }
    return this.result;
  }
}

export class TestPipelineOrchestrator {
  constructor(name = 'Test Pipeline') {
    this.name = name;
    this.stages = [];
    this.results = [];
    this.context = {};
    this.hooks = { beforeAll: [], afterAll: [], beforeStage: [], afterStage: [] };
  }

  addStage(name, runFn, options = {}) {
    this.stages.push(new PipelineStage(name, runFn, options));
    return this;
  }

  addParallelStages(stageConfigs) {
    // Group stages to run in parallel
    const group = stageConfigs.map(({ name, runFn, options }) => new PipelineStage(name, runFn, { ...options, parallel: true }));
    this.stages.push({ _parallel: true, stages: group });
    return this;
  }

  onBeforeAll(fn) { this.hooks.beforeAll.push(fn); return this; }
  onAfterAll(fn) { this.hooks.afterAll.push(fn); return this; }
  onBeforeStage(fn) { this.hooks.beforeStage.push(fn); return this; }
  onAfterStage(fn) { this.hooks.afterStage.push(fn); return this; }

  async run(context = {}) {
    this.context = { ...context };
    this.results = [];
    const pipelineStart = Date.now();

    for (const hook of this.hooks.beforeAll) await hook(this.context);

    for (const stageOrGroup of this.stages) {
      if (stageOrGroup._parallel) {
        // Run parallel group
        for (const hook of this.hooks.beforeStage) await hook({ name: 'parallel-group', context: this.context });
        const groupResults = await Promise.allSettled(
          stageOrGroup.stages.map((s) => s.execute(this.context))
        );
        for (const r of groupResults) {
          const result = r.status === 'fulfilled' ? r.value : { name: 'unknown', passed: false, error: r.reason?.message };
          this.results.push(result);
        }
        for (const hook of this.hooks.afterStage) await hook({ results: groupResults, context: this.context });
      } else {
        for (const hook of this.hooks.beforeStage) await hook({ name: stageOrGroup.name, context: this.context });
        try {
          const result = await stageOrGroup.execute(this.context);
          this.results.push(result);
          this.context[stageOrGroup.name] = result.output;
        } catch {
          this.results.push(stageOrGroup.result);
        }
        for (const hook of this.hooks.afterStage) await hook({ result: stageOrGroup.result, context: this.context });
      }
    }

    for (const hook of this.hooks.afterAll) await hook(this.context);

    return this.generateReport(Date.now() - pipelineStart);
  }

  generateReport(totalDuration) {
    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;
    return {
      pipeline: this.name,
      status: failed === 0 ? 'PASS' : 'FAIL',
      totalDuration,
      stages: { total: this.results.length, passed, failed },
      results: this.results,
      timestamp: new Date().toISOString(),
    };
  }
}

export class TestResultAggregator {
  constructor() {
    this.suites = [];
  }

  addSuite(name, results) {
    this.suites.push({ name, results, timestamp: new Date().toISOString() });
    return this;
  }

  aggregate() {
    const allResults = this.suites.flatMap((s) => s.results.map((r) => ({ ...r, suite: s.name })));
    const total = allResults.length;
    const passed = allResults.filter((r) => r.passed).length;
    const failed = allResults.filter((r) => !r.passed).length;
    const totalDuration = allResults.reduce((sum, r) => sum + (r.duration || 0), 0);

    return {
      total,
      passed,
      failed,
      passRate: total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : '0%',
      totalDuration,
      suites: this.suites.length,
      failures: allResults.filter((r) => !r.passed),
    };
  }

  generateJUnitXML() {
    const agg = this.aggregate();
    const cases = this.suites
      .flatMap((s) =>
        s.results.map((r) => {
          const failure = !r.passed ? `<failure message="${r.error || 'Test failed'}" />` : '';
          return `    <testcase name="${r.name || 'unknown'}" classname="${s.name}" time="${((r.duration || 0) / 1000).toFixed(3)}">${failure}</testcase>`;
        })
      )
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="${agg.total}" failures="${agg.failed}" time="${(agg.totalDuration / 1000).toFixed(3)}">
  <testsuite name="Aggregated Results" tests="${agg.total}" failures="${agg.failed}">
${cases}
  </testsuite>
</testsuites>`;
  }
}

export class FailureAnalyzer {
  analyze(failures) {
    if (!failures || failures.length === 0) return { patterns: [], recommendations: [], severity: 'NONE' };

    const patterns = this._detectPatterns(failures);
    const recommendations = this._generateRecommendations(patterns);
    const severity = this._calculateSeverity(failures);

    return { patterns, recommendations, severity, totalFailures: failures.length };
  }

  _detectPatterns(failures) {
    const patterns = [];
    const errorMessages = failures.map((f) => f.error || '').filter(Boolean);

    // Timeout pattern
    const timeouts = errorMessages.filter((m) => m.toLowerCase().includes('timeout'));
    if (timeouts.length > 0) patterns.push({ type: 'TIMEOUT', count: timeouts.length, message: 'Multiple timeout failures detected' });

    // Network pattern
    const network = errorMessages.filter((m) => /network|connection|econnrefused/i.test(m));
    if (network.length > 0) patterns.push({ type: 'NETWORK', count: network.length, message: 'Network connectivity issues detected' });

    // Assertion pattern
    const assertions = errorMessages.filter((m) => /expect|assert|toBe|toEqual/i.test(m));
    if (assertions.length > 0) patterns.push({ type: 'ASSERTION', count: assertions.length, message: 'Assertion failures detected' });

    // Flaky pattern (same test failing intermittently)
    const names = failures.map((f) => f.name).filter(Boolean);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    if (duplicates.length > 0) patterns.push({ type: 'FLAKY', count: duplicates.length, message: 'Potentially flaky tests detected' });

    return patterns;
  }

  _generateRecommendations(patterns) {
    return patterns.map((p) => {
      switch (p.type) {
        case 'TIMEOUT': return 'Increase test timeouts or optimize slow operations';
        case 'NETWORK': return 'Check service availability and mock external dependencies';
        case 'ASSERTION': return 'Review test assertions and expected values';
        case 'FLAKY': return 'Add retry logic or investigate race conditions in flaky tests';
        default: return 'Review failing tests for common root causes';
      }
    });
  }

  _calculateSeverity(failures) {
    const rate = failures.length;
    if (rate >= 10) return 'CRITICAL';
    if (rate >= 5) return 'HIGH';
    if (rate >= 2) return 'MEDIUM';
    return 'LOW';
  }
}

export class PipelineDashboard {
  constructor() {
    this.runs = [];
  }

  recordRun(report) {
    this.runs.push({ ...report, recordedAt: new Date().toISOString() });
    return this;
  }

  getTrend(limit = 10) {
    return this.runs.slice(-limit).map((r) => ({
      timestamp: r.timestamp,
      status: r.status,
      passed: r.stages?.passed || 0,
      failed: r.stages?.failed || 0,
      duration: r.totalDuration,
    }));
  }

  getStats() {
    if (this.runs.length === 0) return { totalRuns: 0, passRate: '0%', avgDuration: 0 };
    const passed = this.runs.filter((r) => r.status === 'PASS').length;
    const avgDuration = this.runs.reduce((sum, r) => sum + (r.totalDuration || 0), 0) / this.runs.length;
    return {
      totalRuns: this.runs.length,
      passRate: ((passed / this.runs.length) * 100).toFixed(1) + '%',
      avgDuration: Math.round(avgDuration),
      lastStatus: this.runs[this.runs.length - 1]?.status || 'UNKNOWN',
    };
  }
}

export const createPipelineOrchestrator = (name) => new TestPipelineOrchestrator(name);
export const createResultAggregator = () => new TestResultAggregator();
export const createFailureAnalyzer = () => new FailureAnalyzer();
export const createPipelineDashboard = () => new PipelineDashboard();
