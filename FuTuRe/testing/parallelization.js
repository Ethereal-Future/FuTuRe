/**
 * Test Parallelization Utilities
 * Run tests in parallel with worker management
 */

export class TestQueue {
  constructor(maxWorkers = 4) {
    this.maxWorkers = maxWorkers;
    this.queue = [];
    this.running = 0;
    this.results = [];
  }

  async add(testFn, name = '') {
    return new Promise((resolve) => {
      this.queue.push({ testFn, name, resolve });
      this.process();
    });
  }

  async process() {
    while (this.running < this.maxWorkers && this.queue.length > 0) {
      this.running++;
      const { testFn, name, resolve } = this.queue.shift();

      try {
        const startTime = Date.now();
        const result = await testFn();
        const duration = Date.now() - startTime;

        this.results.push({
          name,
          passed: true,
          duration,
          result,
        });

        resolve({ passed: true, result });
      } catch (error) {
        this.results.push({
          name,
          passed: false,
          error: error.message,
        });

        resolve({ passed: false, error: error.message });
      } finally {
        this.running--;
        this.process();
      }
    }
  }

  async waitAll() {
    return new Promise((resolve) => {
      const checkComplete = () => {
        if (this.running === 0 && this.queue.length === 0) {
          resolve(this.results);
        } else {
          setTimeout(checkComplete, 10);
        }
      };
      checkComplete();
    });
  }

  getResults() {
    return this.results;
  }

  getSummary() {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    const failed = total - passed;
    const totalDuration = this.results.reduce((sum, r) => sum + (r.duration || 0), 0);

    return {
      total,
      passed,
      failed,
      passRate: ((passed / total) * 100).toFixed(2) + '%',
      totalDuration,
      avgDuration: (totalDuration / total).toFixed(2),
    };
  }
}

export const createTestQueue = (maxWorkers = 4) => new TestQueue(maxWorkers);

export const parallelizeTests = async (tests, maxWorkers = 4) => {
  const queue = createTestQueue(maxWorkers);

  for (const test of tests) {
    await queue.add(test.fn, test.name);
  }

  return queue.waitAll();
};
