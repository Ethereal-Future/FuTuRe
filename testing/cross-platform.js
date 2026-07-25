/**
 * Cross-Platform Testing Utilities (#101)
 * OS, device, responsive design, and cross-platform automation
 */

// Operating system profiles
export const OS_PROFILES = {
  windows: {
    name: 'Windows',
    platform: 'Win32',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    pathSeparator: '\\',
    lineEnding: '\r\n',
  },
  macos: {
    name: 'macOS',
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
    pathSeparator: '/',
    lineEnding: '\n',
  },
  linux: {
    name: 'Linux',
    platform: 'Linux x86_64',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    pathSeparator: '/',
    lineEnding: '\n',
  },
  android: {
    name: 'Android',
    platform: 'Linux armv8l',
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
    pathSeparator: '/',
    lineEnding: '\n',
  },
  ios: {
    name: 'iOS',
    platform: 'iPhone',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    pathSeparator: '/',
    lineEnding: '\n',
  },
};

// Device profiles with viewport and capabilities
export const DEVICE_PROFILES = {
  desktop_4k: { name: 'Desktop 4K', viewport: { width: 3840, height: 2160 }, dpr: 2, touch: false, category: 'desktop' },
  desktop_hd: { name: 'Desktop HD', viewport: { width: 1920, height: 1080 }, dpr: 1, touch: false, category: 'desktop' },
  desktop_md: { name: 'Desktop MD', viewport: { width: 1440, height: 900 }, dpr: 1, touch: false, category: 'desktop' },
  laptop: { name: 'Laptop', viewport: { width: 1280, height: 800 }, dpr: 1, touch: false, category: 'desktop' },
  tablet_landscape: { name: 'Tablet Landscape', viewport: { width: 1024, height: 768 }, dpr: 2, touch: true, category: 'tablet' },
  tablet_portrait: { name: 'Tablet Portrait', viewport: { width: 768, height: 1024 }, dpr: 2, touch: true, category: 'tablet' },
  mobile_large: { name: 'Mobile Large', viewport: { width: 414, height: 896 }, dpr: 3, touch: true, category: 'mobile' },
  mobile_md: { name: 'Mobile MD', viewport: { width: 375, height: 667 }, dpr: 2, touch: true, category: 'mobile' },
  mobile_sm: { name: 'Mobile SM', viewport: { width: 320, height: 568 }, dpr: 2, touch: true, category: 'mobile' },
};

// Responsive breakpoints matching common CSS frameworks
export const BREAKPOINTS = {
  xs: 320,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
};

export class CrossPlatformTester {
  constructor(options = {}) {
    this.osProfiles = options.osProfiles || Object.values(OS_PROFILES);
    this.deviceProfiles = options.deviceProfiles || Object.values(DEVICE_PROFILES);
    this.results = [];
  }

  async testAcrossOS(testFn) {
    const results = [];
    for (const os of this.osProfiles) {
      try {
        const result = await testFn(os);
        results.push({ os: os.name, passed: true, result });
      } catch (error) {
        results.push({ os: os.name, passed: false, error: error.message });
      }
    }
    this.results.push(...results);
    return results;
  }

  async testAcrossDevices(testFn) {
    const results = [];
    for (const device of this.deviceProfiles) {
      try {
        const result = await testFn(device);
        results.push({ device: device.name, category: device.category, passed: true, result });
      } catch (error) {
        results.push({ device: device.name, category: device.category, passed: false, error: error.message });
      }
    }
    this.results.push(...results);
    return results;
  }

  testResponsiveBreakpoints(checkFn) {
    const results = [];
    for (const [name, width] of Object.entries(BREAKPOINTS)) {
      try {
        const result = checkFn(width, name);
        results.push({ breakpoint: name, width, passed: true, result });
      } catch (error) {
        results.push({ breakpoint: name, width, passed: false, error: error.message });
      }
    }
    return results;
  }

  getSummary() {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    return {
      total,
      passed,
      failed: total - passed,
      passRate: total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : '0%',
    };
  }

  generateReport() {
    const summary = this.getSummary();
    const failures = this.results.filter((r) => !r.passed);
    return {
      summary,
      failures,
      timestamp: new Date().toISOString(),
      status: failures.length === 0 ? 'PASS' : 'FAIL',
    };
  }
}

export class ResponsiveDesignTester {
  constructor(breakpoints = BREAKPOINTS) {
    this.breakpoints = breakpoints;
  }

  /**
   * Check that an element's layout adapts at each breakpoint.
   * testFn receives (width, breakpointName) and should return layout info.
   */
  testLayout(testFn) {
    return Object.entries(this.breakpoints).map(([name, width]) => {
      try {
        const layout = testFn(width, name);
        return { breakpoint: name, width, passed: true, layout };
      } catch (error) {
        return { breakpoint: name, width, passed: false, error: error.message };
      }
    });
  }

  /**
   * Verify that touch targets meet minimum size requirements (44x44px).
   */
  checkTouchTargets(elements) {
    const MIN_SIZE = 44;
    return elements.map((el) => {
      const tooSmall = el.width < MIN_SIZE || el.height < MIN_SIZE;
      return {
        element: el.name || el.selector,
        width: el.width,
        height: el.height,
        passed: !tooSmall,
        issue: tooSmall ? `Touch target ${el.width}x${el.height}px is below 44x44px minimum` : null,
      };
    });
  }

  /**
   * Check viewport meta tag presence (simulated via config object).
   */
  checkViewportMeta(config) {
    const issues = [];
    if (!config.viewportMeta) issues.push('Missing viewport meta tag');
    if (config.viewportMeta && !config.viewportMeta.includes('width=device-width')) {
      issues.push('Viewport meta should include width=device-width');
    }
    return { passed: issues.length === 0, issues };
  }
}

export class CrossPlatformAccessibilityTester {
  constructor() {
    this.results = [];
  }

  /**
   * Run accessibility checks across multiple platform contexts.
   * checkFn receives a platform context and returns { violations: [] }.
   */
  async testAcrossPlatforms(platforms, checkFn) {
    const results = [];
    for (const platform of platforms) {
      try {
        const { violations = [] } = await checkFn(platform);
        results.push({
          platform: platform.name,
          passed: violations.length === 0,
          violations,
        });
      } catch (error) {
        results.push({ platform: platform.name, passed: false, error: error.message, violations: [] });
      }
    }
    this.results = results;
    return results;
  }

  getSummary() {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    const allViolations = this.results.flatMap((r) => r.violations || []);
    return { total, passed, failed: total - passed, totalViolations: allViolations.length };
  }
}

export class CompatibilityReporter {
  constructor() {
    this.reports = [];
  }

  addReport(category, results) {
    this.reports.push({ category, results, timestamp: new Date().toISOString() });
  }

  generateCompatibilityMatrix() {
    const matrix = {};
    for (const { category, results } of this.reports) {
      matrix[category] = results.map((r) => ({
        target: r.os || r.device || r.browser || r.platform || r.breakpoint,
        status: r.passed ? 'PASS' : 'FAIL',
        detail: r.error || null,
      }));
    }
    return matrix;
  }

  getSummary() {
    const allResults = this.reports.flatMap((r) => r.results);
    const total = allResults.length;
    const passed = allResults.filter((r) => r.passed).length;
    return {
      total,
      passed,
      failed: total - passed,
      passRate: total > 0 ? ((passed / total) * 100).toFixed(1) + '%' : '0%',
      categories: this.reports.map((r) => r.category),
    };
  }
}

export const createCrossPlatformTester = (options) => new CrossPlatformTester(options);
export const createResponsiveDesignTester = (breakpoints) => new ResponsiveDesignTester(breakpoints);
export const createCompatibilityReporter = () => new CompatibilityReporter();
