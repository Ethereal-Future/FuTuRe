/**
 * Accessibility Testing Automation
 * Integrates axe-core rules with regression tracking and CI reporting.
 * Can be used with jest-axe/vitest-axe (unit) or @axe-core/playwright (e2e).
 */

import { AccessibilityTester } from './accessibility.js';

export class AccessibilityAutomation {
  constructor(options = {}) {
    this.tester = new AccessibilityTester(options);
    this.baseline = new Map(); // component -> violation count
    this.history = [];
    this.ruleMetadata = options.ruleMetadata || this.tester.getCommonAxeRules();
  }

  async audit(element, componentName = 'unknown') {
    const auditResult = await this.tester.runFullAudit(element);
    const violations = this._normalizeViolations(auditResult.results || []);

    const result = {
      component: componentName,
      passed: violations.length === 0,
      violationCount: violations.length,
      violations,
      source: auditResult.source,
      timestamp: new Date().toISOString(),
    };

    this.history.push(result);
    return result;
  }

  _normalizeViolations(results) {
    if (!Array.isArray(results)) {
      return [];
    }

    return results.map((violation) => {
      const ruleId = violation.ruleId || violation.rule;
      const metadata = this.ruleMetadata[ruleId] || {};

      return {
        rule: ruleId,
        ...metadata,
        detail: violation.message || violation.detail,
        element: violation.element || 'unknown',
        impact: violation.impact || metadata.impact || 'unknown',
      };
    });
  }

  setBaseline(componentName, violationCount) {
    this.baseline.set(componentName, violationCount);
  }

  isRegression(componentName, currentCount) {
    const base = this.baseline.get(componentName);
    if (base === undefined) return false;
    return currentCount > base;
  }

  generateReport() {
    const failed = this.history.filter((r) => !r.passed);
    const regressions = this.history.filter((r) =>
      this.isRegression(r.component, r.violationCount),
    );

    const criticalViolations = this.history.flatMap((r) =>
      r.violations.filter((v) => v.impact === 'critical')
    );

    const seriousViolations = this.history.flatMap((r) =>
      r.violations.filter((v) => v.impact === 'serious')
    );

    return {
      total: this.history.length,
      passed: this.history.length - failed.length,
      failed: failed.length,
      regressions: regressions.length,
      violationsBySeverity: {
        critical: criticalViolations.length,
        serious: seriousViolations.length,
      },
      details: this.history,
      timestamp: new Date().toISOString(),
    };
  }

  coveragePercent() {
    if (this.history.length === 0) return 100;
    const clean = this.history.filter((r) => r.passed).length;
    return Math.round((clean / this.history.length) * 100);
  }
}

export const createA11yAutomation = (options) => new AccessibilityAutomation(options);
