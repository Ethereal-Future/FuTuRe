import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = path.join(__dirname, '../../data/load-tests/baselines');

class PerformanceBaseline {
  constructor(name) {
    this.name = name;
    this.timestamp = new Date().toISOString();
    this.metrics = {
      avgResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      maxResponseTime: 0,
      minResponseTime: Infinity,
      throughput: 0,
      errorRate: 0,
      successCount: 0,
      errorCount: 0,
      totalRequests: 0
    };
  }

  calculateFromResults(results) {
    const responseTimes = results.map(r => r.responseTime).sort((a, b) => a - b);
    const total = responseTimes.length;

    this.metrics.totalRequests = total;
    this.metrics.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / total;
    this.metrics.p95ResponseTime = responseTimes[Math.floor(total * 0.95)];
    this.metrics.p99ResponseTime = responseTimes[Math.floor(total * 0.99)];
    this.metrics.maxResponseTime = Math.max(...responseTimes);
    this.metrics.minResponseTime = Math.min(...responseTimes);
    this.metrics.successCount = results.filter(r => r.success).length;
    this.metrics.errorCount = results.filter(r => !r.success).length;
    this.metrics.errorRate = (this.metrics.errorCount / total) * 100;
    this.metrics.throughput = total / (results[total - 1].timestamp - results[0].timestamp);

    return this;
  }

  async save() {
    await fs.mkdir(BASELINE_DIR, { recursive: true });
    const file = path.join(BASELINE_DIR, `${this.name}-${Date.now()}.json`);
    await fs.writeFile(file, JSON.stringify(this, null, 2));
    return file;
  }

  static async getLatest(name) {
    try {
      await fs.mkdir(BASELINE_DIR, { recursive: true });
      const files = await fs.readdir(BASELINE_DIR);
      const matching = files.filter(f => f.startsWith(name)).sort().reverse();
      if (matching.length === 0) return null;

      const content = await fs.readFile(path.join(BASELINE_DIR, matching[0]), 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  compareWith(other) {
    return {
      avgResponseTimeDiff: ((this.metrics.avgResponseTime - other.metrics.avgResponseTime) / other.metrics.avgResponseTime) * 100,
      p95ResponseTimeDiff: ((this.metrics.p95ResponseTime - other.metrics.p95ResponseTime) / other.metrics.p95ResponseTime) * 100,
      errorRateDiff: this.metrics.errorRate - other.metrics.errorRate,
      throughputDiff: ((this.metrics.throughput - other.metrics.throughput) / other.metrics.throughput) * 100
    };
  }
}

export default PerformanceBaseline;
