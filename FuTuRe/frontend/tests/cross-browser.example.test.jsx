/**
 * Example: Using Cross-Browser Testing
 * Demonstrates testing across different browser environments
 */

import { describe, it, expect } from 'vitest';
import { createCrossBrowserTester, BROWSER_ENVIRONMENTS } from '../../testing/cross-browser.js';

describe('Cross-Browser Testing', () => {
  it('should test across multiple browsers', async () => {
    const tester = createCrossBrowserTester();

    const results = await tester.testAcrossBrowsers(async (browser) => {
      return {
        browserName: browser.name,
        viewport: browser.config.viewport,
        userAgent: browser.config.userAgent.substring(0, 50),
      };
    });

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should get cross-browser test summary', async () => {
    const tester = createCrossBrowserTester();

    await tester.testAcrossBrowsers(async (browser) => {
      return { success: true };
    });

    const summary = tester.getSummary();
    expect(summary.total).toBe(5);
    expect(summary.passed).toBe(5);
    expect(summary.failed).toBe(0);
  });

  it('should handle browser-specific failures', async () => {
    const tester = createCrossBrowserTester([BROWSER_ENVIRONMENTS.chrome, BROWSER_ENVIRONMENTS.firefox]);

    await tester.testAcrossBrowsers(async (browser) => {
      if (browser.name === 'Firefox') {
        throw new Error('Firefox compatibility issue');
      }
      return { success: true };
    });

    const results = tester.getResults();
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
  });
});
