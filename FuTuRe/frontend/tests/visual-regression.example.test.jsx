/**
 * Example: Using Visual Regression Testing
 * Demonstrates snapshot comparison for visual changes
 */

import { describe, it, expect } from 'vitest';
import { createVisualRegressionTest } from '../../testing/visual-regression.js';

describe('Visual Regression Testing', () => {
  it('should capture and compare snapshots', () => {
    const tester = createVisualRegressionTest('component-layout');
    const componentData = {
      layout: 'flex',
      colors: ['#FF5733', '#33FF57'],
      spacing: '16px',
    };

    const snapshot = tester.saveSnapshot(componentData);
    expect(snapshot).toHaveProperty('hash');
    expect(snapshot).toHaveProperty('timestamp');
  });

  it('should detect visual changes', () => {
    const tester = createVisualRegressionTest('button-style');
    const originalData = { color: '#007bff', padding: '8px' };

    tester.saveSnapshot(originalData);

    const modifiedData = { color: '#0056b3', padding: '8px' };
    const comparison = tester.compareSnapshot(modifiedData);

    expect(comparison.match).toBe(false);
    expect(comparison.current).not.toBe(comparison.previous);
  });

  it('should match identical snapshots', () => {
    const tester = createVisualRegressionTest('identical-test');
    const data = { width: '100%', height: '50px' };

    tester.saveSnapshot(data);
    const comparison = tester.compareSnapshot(data);

    expect(comparison.match).toBe(true);
  });
});
