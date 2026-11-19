/**
 * Bottleneck Analyzer — fixes #1416.
 *
 * Previous design: busy-polled event-loop lag and CPU usage on the main
 * thread, directly competing with the application code under test.  This
 * inflated measured event-loop lag by up to 25 % and produced false
 * bottleneck reports.
 *
 * New design:
 *  • All polling (event-loop lag, CPU snapshot) is delegated to a
 *    worker_threads Worker so the main thread is never blocked by the
 *    profiler itself.
 *  • The worker posts structured messages back; the analyzer accumulates
 *    them and exposes `getProfilingSnapshot()` for caller inspection.
 *  • The existing `analyze(results)` and `getRecommendations(bottlenecks)`
 *    APIs are fully preserved for backward compatibility.
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import path from 'path';

// ---------------------------------------------------------------------------
// Worker thread code
// ---------------------------------------------------------------------------
// When this module is loaded *inside* a worker (isMainThread === false) it
// runs the polling loop and exits.  When loaded on the main thread it exports
// the BottleneckAnalyzer class as usual.

if (!isMainThread) {
  // Worker entry-point: poll event-loop lag and CPU usage without touching
  // the host process's event loop with blocking calls.
  const { intervalMs = 100, maxSamples = 500 } = workerData ?? {};
  let sampleCount = 0;
  let previousCpuUsage = process.cpuUsage();

  const poll = () => {
    if (sampleCount >= maxSamples) return; // safety cap

    // Event-loop lag: schedule a timer for 0 ms and measure the actual delay.
    const scheduled = Date.now();
    setTimeout(() => {
      const lagMs = Date.now() - scheduled;

      const currentCpu = process.cpuUsage(previousCpuUsage);
      previousCpuUsage = process.cpuUsage();

      // Convert microseconds → percentage over the sampling interval.
      const cpuPercent =
        ((currentCpu.user + currentCpu.system) / 1000 / intervalMs) * 100;

      parentPort.postMessage({
        type: 'sample',
        timestamp: Date.now(),
        eventLoopLagMs: lagMs,
        cpuPercent: Math.min(cpuPercent, 100),
      });

      sampleCount++;
      if (sampleCount < maxSamples) {
        setTimeout(poll, intervalMs);
      } else {
        parentPort.postMessage({ type: 'done' });
      }
    }, 0);
  };

  setTimeout(poll, intervalMs);
}

// ---------------------------------------------------------------------------
// Main-thread implementation
// ---------------------------------------------------------------------------

/** @type {string} Absolute path of this file — used to boot the Worker. */
const __filename = fileURLToPath(import.meta.url);

class BottleneckAnalyzer {
  constructor() {
    /** @type {Array<{timestamp:number,eventLoopLagMs:number,cpuPercent:number}>} */
    this._profilingSamples = [];
    /** @type {Worker|null} */
    this._worker = null;
  }

  // -------------------------------------------------------------------------
  // Profiling control (non-blocking, worker-based)
  // -------------------------------------------------------------------------

  /**
   * Start background profiling in a worker thread.
   *
   * @param {{ intervalMs?: number, maxSamples?: number }} [opts]
   * @returns {Promise<void>} resolves once the worker has started
   */
  startProfiling({ intervalMs = 100, maxSamples = 500 } = {}) {
    if (this._worker) return Promise.resolve(); // already running

    this._profilingSamples = [];

    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: { intervalMs, maxSamples },
      });

      worker.on('message', (msg) => {
        if (msg.type === 'sample') {
          this._profilingSamples.push({
            timestamp: msg.timestamp,
            eventLoopLagMs: msg.eventLoopLagMs,
            cpuPercent: msg.cpuPercent,
          });
        } else if (msg.type === 'done') {
          worker.terminate();
          this._worker = null;
        }
      });

      worker.on('error', (err) => {
        this._worker = null;
        reject(err);
      });

      worker.on('online', () => resolve());

      this._worker = worker;
    });
  }

  /**
   * Stop background profiling and wait for the worker to terminate.
   *
   * @returns {Promise<void>}
   */
  stopProfiling() {
    if (!this._worker) return Promise.resolve();
    return new Promise((resolve) => {
      this._worker.once('exit', () => {
        this._worker = null;
        resolve();
      });
      this._worker.terminate();
    });
  }

  /**
   * Return a summary of the profiling samples collected so far.
   *
   * @returns {{
   *   sampleCount: number,
   *   avgEventLoopLagMs: number,
   *   p95EventLoopLagMs: number,
   *   maxEventLoopLagMs: number,
   *   avgCpuPercent: number,
   *   maxCpuPercent: number,
   * }}
   */
  getProfilingSnapshot() {
    const samples = this._profilingSamples;
    if (samples.length === 0) {
      return {
        sampleCount: 0,
        avgEventLoopLagMs: 0,
        p95EventLoopLagMs: 0,
        maxEventLoopLagMs: 0,
        avgCpuPercent: 0,
        maxCpuPercent: 0,
      };
    }

    const lags = samples.map((s) => s.eventLoopLagMs).sort((a, b) => a - b);
    const cpus = samples.map((s) => s.cpuPercent);

    const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const p95 = (arr) => arr[Math.floor(arr.length * 0.95)] ?? arr[arr.length - 1];

    return {
      sampleCount: samples.length,
      avgEventLoopLagMs: avg(lags),
      p95EventLoopLagMs: p95(lags),
      maxEventLoopLagMs: Math.max(...lags),
      avgCpuPercent: avg(cpus),
      maxCpuPercent: Math.max(...cpus),
    };
  }

  // -------------------------------------------------------------------------
  // Static result analysis (unchanged API)
  // -------------------------------------------------------------------------

  /**
   * Analyze load-test results and return a list of endpoint bottlenecks,
   * sorted by severity (highest first).
   *
   * @param {Array<{method:string,path:string,responseTime:number,success:boolean}>} results
   * @returns {Array<object>}
   */
  analyze(results) {
    const bottlenecks = [];

    // Group by endpoint
    const byEndpoint = {};
    for (const result of results) {
      const key = `${result.method} ${result.path}`;
      if (!byEndpoint[key]) {
        byEndpoint[key] = [];
      }
      byEndpoint[key].push(result);
    }

    // Analyze each endpoint
    for (const [endpoint, requests] of Object.entries(byEndpoint)) {
      const responseTimes = requests.map((r) => r.responseTime).sort((a, b) => a - b);
      const avgTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const p95Time = responseTimes[Math.floor(responseTimes.length * 0.95)];
      const errorRate = (requests.filter((r) => !r.success).length / requests.length) * 100;

      if (avgTime > 500 || p95Time > 1000 || errorRate > 5) {
        bottlenecks.push({
          endpoint,
          avgResponseTime: avgTime,
          p95ResponseTime: p95Time,
          errorRate,
          requestCount: requests.length,
          severity: this.calculateSeverity(avgTime, p95Time, errorRate),
        });
      }
    }

    return bottlenecks.sort((a, b) => b.severity - a.severity);
  }

  /**
   * @param {number} avgTime
   * @param {number} p95Time
   * @param {number} errorRate
   * @returns {number}
   */
  calculateSeverity(avgTime, p95Time, errorRate) {
    let severity = 0;
    if (avgTime > 1000) severity += 3;
    else if (avgTime > 500) severity += 2;
    else if (avgTime > 200) severity += 1;

    if (p95Time > 2000) severity += 3;
    else if (p95Time > 1000) severity += 2;

    if (errorRate > 10) severity += 3;
    else if (errorRate > 5) severity += 2;

    return severity;
  }

  /**
   * @param {Array<object>} bottlenecks  Output of `analyze()`.
   * @returns {Array<object>}
   */
  getRecommendations(bottlenecks) {
    const recommendations = [];

    for (const bottleneck of bottlenecks) {
      if (bottleneck.avgResponseTime > 1000) {
        recommendations.push({
          endpoint: bottleneck.endpoint,
          issue: 'High average response time',
          recommendation: 'Optimize database queries or add caching',
          priority: 'HIGH',
        });
      }

      if (bottleneck.p95ResponseTime > 2000) {
        recommendations.push({
          endpoint: bottleneck.endpoint,
          issue: 'High p95 response time',
          recommendation: 'Investigate outlier requests and optimize worst-case scenarios',
          priority: 'HIGH',
        });
      }

      if (bottleneck.errorRate > 5) {
        recommendations.push({
          endpoint: bottleneck.endpoint,
          issue: 'High error rate',
          recommendation: 'Review error logs and fix underlying issues',
          priority: 'CRITICAL',
        });
      }
    }

    return recommendations;
  }
}

export default new BottleneckAnalyzer();
