/**
 * Cross-Browser Testing Utilities
 * Manage and test across different browser environments
 */

export class BrowserEnvironment {
  constructor(name, config = {}) {
    this.name = name;
    this.config = {
      userAgent: '',
      viewport: { width: 1024, height: 768 },
      ...config,
    };
  }

  getConfig() {
    return this.config;
  }
}

export const BROWSER_ENVIRONMENTS = {
  chrome: new BrowserEnvironment('Chrome', {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
  }),
  firefox: new BrowserEnvironment('Firefox', {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    viewport: { width: 1920, height: 1080 },
  }),
  safari: new BrowserEnvironment('Safari', {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    viewport: { width: 1440, height: 900 },
  }),
  mobile: new BrowserEnvironment('Mobile', {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    viewport: { width: 375, height: 667 },
  }),
  tablet: new BrowserEnvironment('Tablet', {
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
    viewport: { width: 768, height: 1024 },
  }),
};

export class CrossBrowserTester {
  constructor(browsers = Object.values(BROWSER_ENVIRONMENTS)) {
    this.browsers = browsers;
    this.results = [];
  }

  async testAcrossBrowsers(testFn) {
    const results = [];

    for (const browser of this.browsers) {
      try {
        const result = await testFn(browser);
        results.push({
          browser: browser.name,
          passed: true,
          result,
        });
      } catch (error) {
        results.push({
          browser: browser.name,
          passed: false,
          error: error.message,
        });
      }
    }

    this.results = results;
    return results;
  }

  getResults() {
    return this.results;
  }

  getSummary() {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    const failed = total - passed;

    return {
      total,
      passed,
      failed,
      passRate: ((passed / total) * 100).toFixed(2) + '%',
    };
  }
}

export const createCrossBrowserTester = (browsers) => new CrossBrowserTester(browsers);
