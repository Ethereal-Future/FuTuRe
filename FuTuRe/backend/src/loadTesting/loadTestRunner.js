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

  async runScenario(scenario, baseUrl = 'http://localhost:3001') {
    await fs.mkdir(RESULTS_DIR, { recursive: true });

    this.results = [];
    this.startTime = Date.now();

    const requestsPerSecond = scenario.concurrency / (scenario.rampUp / scenario.duration);
    const totalRequests = Math.floor(scenario.concurrency * scenario.duration);

    for (let i = 0; i < totalRequests; i++) {
      const request = this.selectRequest(scenario.requests);
      const result = await this.executeRequest(baseUrl, request);
      this.results.push(result);

      // Simulate ramp-up
      if (i < scenario.rampUp * requestsPerSecond) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

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

    return {
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
