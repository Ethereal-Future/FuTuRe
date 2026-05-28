/**
 * Accessibility Testing Automation
 * axe-core-compatible rule engine + regression tracking + CI reporting
 */

import { AccessibilityTester } from './accessibility.js';

const WCAG_RULES = {
  'aria-labels': { impact: 'critical', description: 'Interactive elements must have accessible labels' },
  'color-contrast': { impact: 'serious', description: 'Text must meet WCAG AA contrast ratio (4.5:1)' },
  'heading-order': { impact: 'moderate', description: 'Heading levels must not be skipped' },
  'image-alt': { impact: 'critical', description: 'Images must have alternative text' },
  'focus-visible': { impact: 'serious', description: 'Keyboard focus must be visible' },
};

export class AccessibilityAutomation {
  constructor(options = {}) {
    this.tester = new AccessibilityTester();
    this.rules = options.rules ?? Object.keys(WCAG_RULES);
    this.baseline = new Map(); // component -> violation count
    this.history = [];
  }

  /** Run a full audit and return structured results */
  audit(element, componentName = 'unknown') {
    const raw = this.tester.runFullAudit(element);
    const violations = this._mapViolations(raw.results);
    const result = {
      component: componentName,
      passed: violations.length === 0,
      violationCount: violations.length,
      violations,
      timestamp: new Date().toISOString(),
    };
    this.history.push(result);
    return result;
  }

  _mapViolations(results) {
    const violations = [];
    results.ariaLabels?.forEach((v) =>
      violations.push({ rule: 'aria-labels', ...WCAG_RULES['aria-labels'], detail: v.message }),
    );
    results.contrast?.forEach((v) =>
      violations.push({ rule: 'color-contrast', ...WCAG_RULES['color-contrast'], detail: v.message }),
    );
    results.headingStructure?.forEach((v) =>
      violations.push({ rule: 'heading-order', ...WCAG_RULES['heading-order'], detail: v.message }),
    );
    results.altText?.forEach((v) =>
      violations.push({ rule: 'image-alt', ...WCAG_RULES['image-alt'], detail: v.message }),
    );
    return violations;
  }

  /** Save baseline violation count for regression detection */
  setBaseline(componentName, violationCount) {
    this.baseline.set(componentName, violationCount);
  }

  /** Returns true if violations increased vs baseline (regression) */
  isRegression(componentName, currentCount) {
    const base = this.baseline.get(componentName);
    if (base === undefined) return false;
    return currentCount > base;
  }

  /** Generate a CI-friendly report */
  generateReport() {
    const failed = this.history.filter((r) => !r.passed);
    const regressions = this.history.filter((r) =>
      this.isRegression(r.component, r.violationCount),
    );
    return {
      total: this.history.length,
      passed: this.history.length - failed.length,
      failed: failed.length,
      regressions: regressions.length,
      details: this.history,
      timestamp: new Date().toISOString(),
    };
  }

  /** Coverage: percentage of audited components with zero violations */
  coveragePercent() {
    if (this.history.length === 0) return 100;
    const clean = this.history.filter((r) => r.passed).length;
    return Math.round((clean / this.history.length) * 100);
  }
}

export const createA11yAutomation = (options) => new AccessibilityAutomation(options);
