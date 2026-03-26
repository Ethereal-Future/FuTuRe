/**
 * Example: Using Test Parallelization
 * Demonstrates parallel test execution with worker management
 */

import { describe, it, expect } from 'vitest';
import { createTestQueue, parallelizeTests } from '../../testing/parallelization.js';

describe('Test Parallelization', () => {
  it('should queue and execute tests in parallel', async () => {
    const queue = createTestQueue(2);

    const test1 = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve('result-1'), 50);
      });

    const test2 = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve('result-2'), 50);
      });

    const test3 = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve('result-3'), 50);
      });

    await queue.add(test1, 'test-1');
    await queue.add(test2, 'test-2');
    await queue.add(test3, 'test-3');

    const results = await queue.waitAll();
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should handle test failures in parallel execution', async () => {
    const queue = createTestQueue(2);

    const successTest = () => Promise.resolve('success');
    const failTest = () => Promise.reject(new Error('Test failed'));

    await queue.add(successTest, 'success');
    await queue.add(failTest, 'failure');

    const results = await queue.waitAll();
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });

  it('should provide test execution summary', async () => {
    const queue = createTestQueue(2);

    const tests = Array.from({ length: 4 }, (_, i) => () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(`result-${i}`), 10);
      })
    );

    for (let i = 0; i < tests.length; i++) {
      await queue.add(tests[i], `test-${i}`);
    }

    await queue.waitAll();

    const summary = queue.getSummary();
    expect(summary.total).toBe(4);
    expect(summary.passed).toBe(4);
    expect(summary.failed).toBe(0);
    expect(summary).toHaveProperty('totalDuration');
    expect(summary).toHaveProperty('avgDuration');
  });

  it('should parallelize multiple tests at once', async () => {
    const tests = Array.from({ length: 5 }, (_, i) => ({
      name: `test-${i}`,
      fn: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(`result-${i}`), 20);
        }),
    }));

    const results = await parallelizeTests(tests, 3);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});
