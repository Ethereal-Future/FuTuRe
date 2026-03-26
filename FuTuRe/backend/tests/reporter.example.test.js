/**
 * Example: Using Test Reporting
 * Demonstrates test report generation and dashboard
 */

import { describe, it, expect } from 'vitest';
import { createTestReporter } from '../../testing/reporter.js';

describe('Test Reporting', () => {
  it('should create and generate test reports', () => {
    const reporter = createTestReporter();

    const tests = [
      { name: 'test-1', passed: true, duration: 100 },
      { name: 'test-2', passed: true, duration: 150 },
      { name: 'test-3', passed: false, duration: 50 },
    ];

    reporter.addSuite('Suite 1', tests);

    const report = reporter.generateReport();
    expect(report.summary.total).toBe(3);
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failed).toBe(1);
  });

  it('should calculate pass rate', () => {
    const reporter = createTestReporter();

    const tests = [
      { name: 'test-1', passed: true, duration: 100 },
      { name: 'test-2', passed: true, duration: 100 },
      { name: 'test-3', passed: true, duration: 100 },
      { name: 'test-4', passed: false, duration: 100 },
    ];

    reporter.addSuite('Suite 1', tests);

    const report = reporter.generateReport();
    expect(report.summary.passRate).toBe('75.00%');
  });

  it('should save reports in JSON format', () => {
    const reporter = createTestReporter();

    const tests = [{ name: 'test-1', passed: true, duration: 100 }];
    reporter.addSuite('Suite 1', tests);

    const filepath = reporter.saveReport('json');
    expect(filepath).toContain('report-');
    expect(filepath).toContain('.json');
  });

  it('should generate HTML reports', () => {
    const reporter = createTestReporter();

    const tests = [
      { name: 'test-1', passed: true, duration: 100 },
      { name: 'test-2', passed: false, duration: 50 },
    ];

    reporter.addSuite('Suite 1', tests);

    const report = reporter.generateReport();
    const html = reporter.generateHtmlReport(report);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Test Report');
    expect(html).toContain('Suite 1');
  });
});
