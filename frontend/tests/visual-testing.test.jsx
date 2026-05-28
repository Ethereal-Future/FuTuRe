import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { VisualTestingFramework } from '../../testing/visual-testing.js';
import StatusMessage from '../src/components/StatusMessage.jsx';
import NetworkBadge from '../src/components/NetworkBadge.jsx';
import Spinner from '../src/components/Spinner.jsx';

// Serialise rendered HTML for visual snapshot comparison
const snapshot = (container) => ({
  html: container.innerHTML,
  childCount: container.childElementCount,
});

describe('Visual Testing Framework', () => {
  let vt;

  beforeEach(() => {
    vt = new VisualTestingFramework({ threshold: 0.01 });
  });

  describe('Baseline management', () => {
    it('creates a new baseline on first run', () => {
      const result = vt.compare('vt-new-component', { html: '<div>hello</div>' });
      expect(result.newBaseline).toBe(true);
      expect(result.passed).toBe(true);
    });

    it('passes when render matches baseline', () => {
      const data = { html: '<button>Pay</button>' };
      vt.saveBaseline('vt-stable', data);
      const result = vt.compare('vt-stable', data);
      expect(result.passed).toBe(true);
      expect(result.diffRatio).toBe(0);
    });

    it('fails when render differs from baseline', () => {
      vt.saveBaseline('vt-changed', { html: '<button>Old</button>' });
      const result = vt.compare('vt-changed', { html: '<button>New</button>' });
      expect(result.passed).toBe(false);
      expect(result.diffRatio).toBeGreaterThan(0);
    });

    it('approves a new baseline', () => {
      vt.saveBaseline('vt-approve', { html: '<div>v1</div>' });
      const newData = { html: '<div>v2</div>' };
      vt.approveBaseline('vt-approve', newData);
      const result = vt.compare('vt-approve', newData);
      expect(result.passed).toBe(true);
    });
  });

  describe('Component visual snapshots', () => {
    it('StatusMessage – success variant is visually stable', () => {
      const { container } = render(
        <StatusMessage type="success" message="Payment sent" />,
      );
      const result = vt.compare('status-message-success', snapshot(container));
      expect(result.passed).toBe(true);
    });

    it('StatusMessage – error variant is visually stable', () => {
      const { container } = render(
        <StatusMessage type="error" message="Transaction failed" />,
      );
      const result = vt.compare('status-message-error', snapshot(container));
      expect(result.passed).toBe(true);
    });

    it('NetworkBadge – testnet is visually stable', () => {
      const { container } = render(<NetworkBadge network="testnet" />);
      const result = vt.compare('network-badge-testnet', snapshot(container));
      expect(result.passed).toBe(true);
    });

    it('Spinner is visually stable', () => {
      const { container } = render(<Spinner />);
      const result = vt.compare('spinner', snapshot(container));
      expect(result.passed).toBe(true);
    });
  });

  describe('Cross-browser visual comparison', () => {
    it('renders consistently across simulated browsers', () => {
      const data = { html: '<div class="card">XLM 100</div>' };
      const results = vt.crossBrowserCompare('payment-card', () => data);
      results.forEach((r) => expect(r.passed).toBe(true));
    });
  });

  describe('Diff reporting', () => {
    it('generates a report with pass/fail counts', () => {
      const results = [
        { passed: true, name: 'a' },
        { passed: true, name: 'b' },
        { passed: false, name: 'c', diffRatio: 1 },
      ];
      const report = vt.generateReport(results);
      expect(report.total).toBe(3);
      expect(report.passed).toBe(2);
      expect(report.failed).toBe(1);
      expect(report.passRate).toBeCloseTo(66.67, 1);
    });
  });
});
