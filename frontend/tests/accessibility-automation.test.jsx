import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { AccessibilityAutomation } from '../../testing/accessibility-automation.js';
import StatusMessage from '../src/components/StatusMessage.jsx';
import NetworkBadge from '../src/components/NetworkBadge.jsx';
import Spinner from '../src/components/Spinner.jsx';
import ErrorBoundary from '../src/components/ErrorBoundary.jsx';

let a11y;

beforeEach(() => {
  a11y = new AccessibilityAutomation();
});

describe('Accessibility Testing Automation', () => {
  describe('WCAG rule audits', () => {
    it('StatusMessage passes accessibility audit', () => {
      const { container } = render(<StatusMessage type="success" message="Sent!" />);
      const result = a11y.audit(container, 'StatusMessage');
      expect(result.passed).toBe(true);
      expect(result.violationCount).toBe(0);
    });

    it('NetworkBadge passes accessibility audit', () => {
      const { container } = render(<NetworkBadge network="testnet" />);
      const result = a11y.audit(container, 'NetworkBadge');
      expect(result.passed).toBe(true);
    });

    it('Spinner passes accessibility audit', () => {
      const { container } = render(<Spinner />);
      const result = a11y.audit(container, 'Spinner');
      expect(result.passed).toBe(true);
    });

    it('detects missing aria-label on unlabelled button', () => {
      const { container } = render(
        <button data-testid="bare-btn" />,
      );
      const result = a11y.audit(container, 'BareButton');
      // A button with no text/aria-label should flag a violation
      const ariaViolations = result.violations.filter((v) => v.rule === 'aria-labels');
      expect(ariaViolations.length).toBeGreaterThan(0);
    });
  });

  describe('Regression detection', () => {
    it('detects a regression when violation count increases', () => {
      a11y.setBaseline('MyComponent', 0);
      expect(a11y.isRegression('MyComponent', 1)).toBe(true);
    });

    it('does not flag regression when count stays the same', () => {
      a11y.setBaseline('MyComponent', 2);
      expect(a11y.isRegression('MyComponent', 2)).toBe(false);
    });

    it('does not flag regression for new components without baseline', () => {
      expect(a11y.isRegression('NewComponent', 5)).toBe(false);
    });
  });

  describe('Coverage tracking', () => {
    it('reports 100% coverage when all components pass', () => {
      const { container: c1 } = render(<Spinner />);
      const { container: c2 } = render(<NetworkBadge network="testnet" />);
      a11y.audit(c1, 'Spinner');
      a11y.audit(c2, 'NetworkBadge');
      expect(a11y.coveragePercent()).toBe(100);
    });

    it('reduces coverage when a component has violations', () => {
      const { container: c1 } = render(<Spinner />);
      const { container: c2 } = render(<button />);
      a11y.audit(c1, 'Spinner');
      a11y.audit(c2, 'BareButton');
      expect(a11y.coveragePercent()).toBeLessThan(100);
    });
  });

  describe('Report generation', () => {
    it('generates a report with correct structure', () => {
      const { container } = render(<Spinner />);
      a11y.audit(container, 'Spinner');
      const report = a11y.generateReport();
      expect(report).toMatchObject({
        total: expect.any(Number),
        passed: expect.any(Number),
        failed: expect.any(Number),
        regressions: expect.any(Number),
        timestamp: expect.any(String),
      });
    });
  });
});
