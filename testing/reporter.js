/**
 * Test Reporting Dashboard
 * Generate and manage test reports
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { redactSensitiveData } from './privacy.js';

const REPORTS_DIR = './test-reports';

export class TestReporter {
  constructor() {
    this.suites = [];
    this.startTime = Date.now();
    this.ensureReportsDir();
  }

  ensureReportsDir() {
    if (!existsSync(REPORTS_DIR)) {
      mkdirSync(REPORTS_DIR, { recursive: true });
    }
  }

  addSuite(name, tests) {
    const suite = {
      name,
      tests,
      passed: tests.filter((t) => t.passed).length,
      failed: tests.filter((t) => !t.passed).length,
      duration: tests.reduce((sum, t) => sum + (t.duration || 0), 0),
    };
    this.suites.push(suite);
    return suite;
  }

  generateReport() {
    const duration = Date.now() - this.startTime;
    const totalTests = this.suites.reduce((sum, s) => sum + s.tests.length, 0);
    const totalPassed = this.suites.reduce((sum, s) => sum + s.passed, 0);
    const totalFailed = this.suites.reduce((sum, s) => sum + s.failed, 0);

    return {
      timestamp: new Date().toISOString(),
      duration,
      summary: {
        total: totalTests,
        passed: totalPassed,
        failed: totalFailed,
        passRate: ((totalPassed / totalTests) * 100).toFixed(2) + '%',
      },
      suites: this.suites,
    };
  }

  saveReport(format = 'json') {
    const report = redactSensitiveData(this.generateReport());
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `report-${timestamp}.${format}`;
    const filepath = join(REPORTS_DIR, filename);

    if (format === 'json') {
      writeFileSync(filepath, JSON.stringify(report, null, 2));
    } else if (format === 'html') {
      writeFileSync(filepath, this.generateHtmlReport(report));
    }

    return filepath;
  }

  generateHtmlReport(report) {
    const suiteRows = report.suites
      .map(
        (suite) => `
      <tr>
        <td>${suite.name}</td>
        <td>${suite.tests.length}</td>
        <td style="color: green;">${suite.passed}</td>
        <td style="color: red;">${suite.failed}</td>
        <td>${suite.duration}ms</td>
      </tr>
    `
      )
      .join('');

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #4CAF50; color: white; }
        .summary { margin-bottom: 20px; }
        .pass { color: green; }
        .fail { color: red; }
      </style>
    </head>
    <body>
      <h1>Test Report</h1>
      <div class="summary">
        <p><strong>Generated:</strong> ${report.timestamp}</p>
        <p><strong>Total Duration:</strong> ${report.duration}ms</p>
        <p><strong>Total Tests:</strong> ${report.summary.total}</p>
        <p class="pass"><strong>Passed:</strong> ${report.summary.passed}</p>
        <p class="fail"><strong>Failed:</strong> ${report.summary.failed}</p>
        <p><strong>Pass Rate:</strong> ${report.summary.passRate}</p>
      </div>
      <table>
        <tr>
          <th>Suite</th>
          <th>Total</th>
          <th>Passed</th>
          <th>Failed</th>
          <th>Duration</th>
        </tr>
        ${suiteRows}
      </table>
    </body>
    </html>
  `;
  }
}

export const createTestReporter = () => new TestReporter();
