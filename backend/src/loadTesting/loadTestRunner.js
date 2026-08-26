import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, '../../data/load-tests/results');

class LoadTestRunner {
  constructor() {
    this.results = [];
    this.startTime = null;
    this.endTime = null;
  }

  /**
   * Run `concurrency` workers in parallel, each issuing requests until the
   * request budget is spent or `duration` elapses. Workers stagger their
   * start across `rampUp` seconds so load climbs rather than arriving as a
   * single burst.
   *
   * Request budget is `concurrency * duration` (same product as the old
   * serial loop) so existing scenario files keep a comparable total, but
   * those requests are now genuinely in flight together. Duration is a
   * wall-clock cap for slow backends.
   */
  async runScenario(scenario, baseUrl = 'http://localhost:3001') {
    await fs.mkdir(RESULTS_DIR, { recursive: true });

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
        headers: { 'Content-Type': 'application/json' }
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
        path: request.path
      };
    } catch (error) {
      return {
        timestamp: startTime,
        responseTime: Date.now() - startTime,
        statusCode: 0,
        success: false,
        method: request.method,
        path: request.path,
        error: error.message
      };
    }
  }

  getResults() {
    const responseTimes = this.results.map(r => r.responseTime).sort((a, b) => a - b);
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
        duration: this.endTime && this.startTime ? (this.endTime - this.startTime) / 1000 : 0
      };
    }

    return {
      executionModel: 'concurrent',
      totalRequests: total,
      successCount: this.results.filter(r => r.success).length,
      errorCount: this.results.filter(r => !r.success).length,
      errorRate: (this.results.filter(r => !r.success).length / total) * 100,
      avgResponseTime: responseTimes.reduce((a, b) => a + b, 0) / total,
      minResponseTime: Math.min(...responseTimes),
      maxResponseTime: Math.max(...responseTimes),
      p50ResponseTime: responseTimes[Math.floor(total * 0.50)],
      p95ResponseTime: responseTimes[Math.floor(total * 0.95)],
      p99ResponseTime: responseTimes[Math.floor(total * 0.99)],
      throughput: total / ((this.endTime - this.startTime) / 1000),
      duration: (this.endTime - this.startTime) / 1000
    };
  }

  async saveResults(testName) {
    const results = {
      testName,
      timestamp: new Date().toISOString(),
      results: this.results,
      summary: this.getResults()
    };

    const file = path.join(RESULTS_DIR, `${testName}-${Date.now()}.json`);
    await fs.writeFile(file, JSON.stringify(results, null, 2));
    return results;
  }

  static async getLatestResults(testName, limit = 10) {
    try {
      await fs.mkdir(RESULTS_DIR, { recursive: true });
      const files = await fs.readdir(RESULTS_DIR);
      const matching = files.filter(f => f.startsWith(testName)).sort().reverse().slice(0, limit);

      const results = [];
      for (const file of matching) {
        const content = await fs.readFile(path.join(RESULTS_DIR, file), 'utf-8');
        results.push(JSON.parse(content));
      }

      return results;
    } catch (error) {
      return [];
    }
  }
}

export default LoadTestRunner;
