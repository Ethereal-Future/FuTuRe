/**
 * Load Test Runner — stores results in Postgres via Prisma instead of writing
 * per-run JSON files to backend/data/load-tests/results/.  Results are now
 * visible to all process instances and survive restarts.
 *
 * Migrated as part of Issue #1125.
 */
import { throughputRps } from './throughput.js';
import prisma from '../db/client.js';

class LoadTestRunner {
  constructor() {
    this.results = [];
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * Run `concurrency` workers in parallel, each issuing requests until the
   * request budget is spent or `duration` elapses.  Workers stagger their
   * start across `rampUp` seconds so load climbs rather than arriving as a
   * single burst.
   *
   * Request budget is `concurrency * duration` (same product as the old serial
   * loop) so existing scenario files keep a comparable total, but those
   * requests are now genuinely in flight together.  Duration is a wall-clock
   * cap for slow backends.
   */
  async runScenario(scenario, baseUrl = 'http://localhost:3001') {
    this.results = [];
    this.startTime = Date.now();

    const concurrency = Math.max(1, Number(scenario.concurrency) || 1);
    const durationSec = Math.max(0, Number(scenario.duration) || 0);
    const rampUpSec = Math.max(0, Number(scenario.rampUp) || 0);
    const durationMs = durationSec * 1000;
    const rampUpMs = rampUpSec * 1000;
    const deadline = this.startTime + durationMs;
    const totalRequests = Math.floor(concurrency * durationSec);
    const requests = scenario.requests || [];

    if (totalRequests === 0 || requests.length === 0) {
      this.endTime = Date.now();
      return this.getResults();
    }

    let issued = 0;

    const worker = async (workerIndex) => {
      if (rampUpMs > 0 && concurrency > 1) {
        const delay = (workerIndex / concurrency) * rampUpMs;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      while (Date.now() < deadline) {
        const n = issued++;
        if (n >= totalRequests) break;
        const request = this.selectRequest(requests);
        const result = await this.executeRequest(baseUrl, request);
        this.results.push(result);
      }
    };

    await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

    this.endTime = Date.now();
    return this.getResults();
  }

  selectRequest(requests) {
    const totalWeight = requests.reduce((sum, r) => sum + r.weight, 0);
    let random = Math.random() * totalWeight;

    for (const request of requests) {
      random -= request.weight;
      if (random <= 0) return request;
    }

    return requests[0];
  }

  async executeRequest(baseUrl, request) {
    const startTime = Date.now();

    try {
      const url = `${baseUrl}${request.path}`;
      const options = {
        method: request.method,
        headers: { 'Content-Type': 'application/json' },
      };

      if (request.body) {
        options.body = JSON.stringify(request.body);
      }

      const response = await fetch(url, options);
      const responseTime = Date.now() - startTime;

      return {
        timestamp: startTime,
        responseTime,
        statusCode: response.status,
        success: response.status >= 200 && response.status < 300,
        method: request.method,
        path: request.path,
      };
    } catch (error) {
      return {
        timestamp: startTime,
        responseTime: Date.now() - startTime,
        statusCode: 0,
        success: false,
        method: request.method,
        path: request.path,
        error: error.message,
      };
    }
  }

  /**
   * @returns {object} summary whose `throughput` field is requests per second (req/s)
   */
  getResults() {
    const responseTimes = this.results.map((r) => r.responseTime).sort((a, b) => a - b);
    const total = this.results.length;

    if (total === 0) {
      return {
        executionModel: 'concurrent',
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        errorRate: 0,
        avgResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        p50ResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        throughput: 0,
        duration: this.endTime && this.startTime ? (this.endTime - this.startTime) / 1000 : 0,
      };
    }

    return {
      executionModel: 'concurrent',
      totalRequests: total,
      successCount: this.results.filter((r) => r.success).length,
      errorCount: this.results.filter((r) => !r.success).length,
      errorRate: (this.results.filter((r) => !r.success).length / total) * 100,
      avgResponseTime: responseTimes.reduce((a, b) => a + b, 0) / total,
      minResponseTime: Math.min(...responseTimes),
      maxResponseTime: Math.max(...responseTimes),
      p50ResponseTime: responseTimes[Math.floor(total * 0.5)],
      p95ResponseTime: responseTimes[Math.floor(total * 0.95)],
      p99ResponseTime: responseTimes[Math.floor(total * 0.99)],
      /** Throughput in requests per second (req/s). */
      throughput: throughputRps(total, this.endTime - this.startTime),
      duration: (this.endTime - this.startTime) / 1000,
    };
  }

  /**
   * Persist the current run's results and summary to Postgres.
   * @param {string} testName
   * @returns {Promise<object>}
   */
  async saveResults(testName) {
    const summary = this.getResults();
    const record = await prisma.loadTestResult.create({
      data: {
        testName,
        metrics: {
          summary,
          rawResults: this.results,
        },
      },
    });

    return {
      id: record.id,
      testName: record.testName,
      timestamp: record.createdAt.toISOString(),
      results: this.results,
      summary,
    };
  }

  /**
   * Retrieve the most recent `limit` results for a named test.
   * @param {string} testName
   * @param {number} [limit=10]
   * @returns {Promise<object[]>}
   */
  static async getLatestResults(testName, limit = 10) {
    const records = await prisma.loadTestResult.findMany({
      where: { testName },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return records.map((r) => ({
      id: r.id,
      testName: r.testName,
      timestamp: r.createdAt.toISOString(),
      ...r.metrics,
    }));
  }
}

export default LoadTestRunner;
