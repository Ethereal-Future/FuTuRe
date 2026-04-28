/**
 * Cross-Platform Testing Suite (#101)
 * Cross-browser, mobile, OS, device compatibility, responsive design, accessibility
 */

import { describe, it, expect } from 'vitest';
import {
  CrossPlatformTester,
  ResponsiveDesignTester,
  CrossPlatformAccessibilityTester,
  CompatibilityReporter,
  OS_PROFILES,
  DEVICE_PROFILES,
  BREAKPOINTS,
  createCrossPlatformTester,
  createResponsiveDesignTester,
  createCompatibilityReporter,
} from '../../testing/cross-platform.js';
import { BROWSER_ENVIRONMENTS, createCrossBrowserTester } from '../../testing/cross-browser.js';

// ── Cross-Browser Testing ────────────────────────────────────────────────────

describe('Cross-Browser Testing Suite', () => {
  it('should test across all major browsers', async () => {
    const tester = createCrossBrowserTester();
    const results = await tester.testAcrossBrowsers(async (browser) => ({
      name: browser.name,
      viewport: browser.config.viewport,
      hasUserAgent: !!browser.config.userAgent,
    }));

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should report browser compatibility summary', async () => {
    const tester = createCrossBrowserTester();
    await tester.testAcrossBrowsers(async () => ({ ok: true }));
    const summary = tester.getSummary();

    expect(summary.total).toBe(5);
    expect(summary.passed).toBe(5);
    expect(summary.failed).toBe(0);
    expect(summary.passRate).toBe('100.00%');
  });

  it('should isolate browser-specific failures', async () => {
    const tester = createCrossBrowserTester([BROWSER_ENVIRONMENTS.chrome, BROWSER_ENVIRONMENTS.firefox]);
    await tester.testAcrossBrowsers(async (browser) => {
      if (browser.name === 'Firefox') throw new Error('Firefox-specific issue');
      return { ok: true };
    });

    const results = tester.getResults();
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(false);
    expect(results[1].error).toContain('Firefox-specific issue');
  });

  it('should validate viewport dimensions per browser', async () => {
    const tester = createCrossBrowserTester();
    const results = await tester.testAcrossBrowsers(async (browser) => {
      const { width, height } = browser.config.viewport;
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      return { width, height };
    });

    expect(results.every((r) => r.passed)).toBe(true);
  });
});

// ── Operating System Testing ─────────────────────────────────────────────────

describe('Operating System Compatibility Testing', () => {
  it('should define all major OS profiles', () => {
    expect(OS_PROFILES.windows).toBeDefined();
    expect(OS_PROFILES.macos).toBeDefined();
    expect(OS_PROFILES.linux).toBeDefined();
    expect(OS_PROFILES.android).toBeDefined();
    expect(OS_PROFILES.ios).toBeDefined();
  });

  it('should test across all OS profiles', async () => {
    const tester = createCrossPlatformTester();
    const results = await tester.testAcrossOS(async (os) => ({
      platform: os.platform,
      hasUserAgent: !!os.userAgent,
    }));

    expect(results).toHaveLength(Object.keys(OS_PROFILES).length);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should detect OS-specific path separators', async () => {
    const tester = createCrossPlatformTester();
    const results = await tester.testAcrossOS(async (os) => {
      expect(os.pathSeparator).toMatch(/^[/\\]$/);
      return { separator: os.pathSeparator };
    });

    const windows = results.find((r) => r.os === 'Windows');
    const linux = results.find((r) => r.os === 'Linux');
    expect(windows.result.separator).toBe('\\');
    expect(linux.result.separator).toBe('/');
  });

  it('should handle OS-specific line endings', async () => {
    const tester = createCrossPlatformTester();
    const results = await tester.testAcrossOS(async (os) => {
      expect(os.lineEnding).toBeDefined();
      return { lineEnding: os.lineEnding };
    });

    expect(results.every((r) => r.passed)).toBe(true);
  });
});

// ── Mobile Platform Testing ──────────────────────────────────────────────────

describe('Mobile Platform Testing', () => {
  it('should define mobile device profiles', () => {
    const mobileDevices = Object.values(DEVICE_PROFILES).filter((d) => d.category === 'mobile');
    expect(mobileDevices.length).toBeGreaterThanOrEqual(3);
  });

  it('should test across mobile devices', async () => {
    const tester = createCrossPlatformTester({
      deviceProfiles: Object.values(DEVICE_PROFILES).filter((d) => d.category === 'mobile'),
    });
    const results = await tester.testAcrossDevices(async (device) => ({
      viewport: device.viewport,
      touch: device.touch,
    }));

    expect(results.every((r) => r.passed)).toBe(true);
    expect(results.every((r) => r.result.touch === true)).toBe(true);
  });

  it('should verify mobile viewports are smaller than desktop', () => {
    const mobileDevices = Object.values(DEVICE_PROFILES).filter((d) => d.category === 'mobile');
    const desktopDevices = Object.values(DEVICE_PROFILES).filter((d) => d.category === 'desktop');

    const maxMobileWidth = Math.max(...mobileDevices.map((d) => d.viewport.width));
    const minDesktopWidth = Math.min(...desktopDevices.map((d) => d.viewport.width));

    expect(maxMobileWidth).toBeLessThan(minDesktopWidth);
  });

  it('should verify mobile devices have touch support', () => {
    const mobileDevices = Object.values(DEVICE_PROFILES).filter((d) => d.category === 'mobile');
    expect(mobileDevices.every((d) => d.touch === true)).toBe(true);
  });
});

// ── Device Compatibility Testing ─────────────────────────────────────────────

describe('Device Compatibility Testing', () => {
  it('should test across all device categories', async () => {
    const tester = createCrossPlatformTester();
    const results = await tester.testAcrossDevices(async (device) => ({
      category: device.category,
      dpr: device.dpr,
    }));

    const categories = [...new Set(results.map((r) => r.category))];
    expect(categories).toContain('desktop');
    expect(categories).toContain('tablet');
    expect(categories).toContain('mobile');
  });

  it('should verify high-DPI device support', () => {
    const highDpiDevices = Object.values(DEVICE_PROFILES).filter((d) => d.dpr >= 2);
    expect(highDpiDevices.length).toBeGreaterThan(0);
    highDpiDevices.forEach((d) => {
      expect(d.dpr).toBeGreaterThanOrEqual(2);
    });
  });

  it('should generate compatibility matrix', async () => {
    const reporter = createCompatibilityReporter();
    const tester = createCrossPlatformTester();

    const deviceResults = await tester.testAcrossDevices(async () => ({ ok: true }));
    reporter.addReport('devices', deviceResults);

    const matrix = reporter.generateCompatibilityMatrix();
    expect(matrix.devices).toBeDefined();
    expect(matrix.devices.length).toBeGreaterThan(0);
    expect(matrix.devices[0]).toHaveProperty('target');
    expect(matrix.devices[0]).toHaveProperty('status');
  });
});

// ── Responsive Design Testing ─────────────────────────────────────────────────

describe('Responsive Design Testing', () => {
  it('should define standard breakpoints', () => {
    expect(BREAKPOINTS.xs).toBe(320);
    expect(BREAKPOINTS.sm).toBe(640);
    expect(BREAKPOINTS.md).toBe(768);
    expect(BREAKPOINTS.lg).toBe(1024);
    expect(BREAKPOINTS.xl).toBe(1280);
  });

  it('should test layout at each breakpoint', () => {
    const tester = createResponsiveDesignTester();
    const results = tester.testLayout((width, name) => {
      const isMobile = width < 768;
      return { width, name, layout: isMobile ? 'stacked' : 'grid' };
    });

    expect(results).toHaveLength(Object.keys(BREAKPOINTS).length);
    expect(results.every((r) => r.passed)).toBe(true);

    const mobileResult = results.find((r) => r.breakpoint === 'xs');
    expect(mobileResult.layout.layout).toBe('stacked');
  });

  it('should validate touch target sizes', () => {
    const tester = createResponsiveDesignTester();
    const elements = [
      { name: 'send-button', width: 48, height: 48 },
      { name: 'nav-link', width: 44, height: 44 },
      { name: 'small-icon', width: 20, height: 20 }, // too small
    ];

    const results = tester.checkTouchTargets(elements);
    expect(results[0].passed).toBe(true);
    expect(results[1].passed).toBe(true);
    expect(results[2].passed).toBe(false);
    expect(results[2].issue).toContain('44x44px minimum');
  });

  it('should validate viewport meta configuration', () => {
    const tester = createResponsiveDesignTester();

    const validConfig = { viewportMeta: 'width=device-width, initial-scale=1' };
    const missingMeta = {};
    const badMeta = { viewportMeta: 'initial-scale=1' };

    expect(tester.checkViewportMeta(validConfig).passed).toBe(true);
    expect(tester.checkViewportMeta(missingMeta).passed).toBe(false);
    expect(tester.checkViewportMeta(badMeta).passed).toBe(false);
  });
});

// ── Cross-Platform Accessibility Testing ─────────────────────────────────────

describe('Cross-Platform Accessibility Testing', () => {
  it('should test accessibility across platforms', async () => {
    const tester = new CrossPlatformAccessibilityTester();
    const platforms = [
      { name: 'Desktop Chrome' },
      { name: 'Mobile Safari' },
      { name: 'Firefox' },
    ];

    const results = await tester.testAcrossPlatforms(platforms, async (platform) => {
      // Simulate accessibility check — no violations on any platform
      return { violations: [] };
    });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it('should report accessibility violations per platform', async () => {
    const tester = new CrossPlatformAccessibilityTester();
    const platforms = [{ name: 'Desktop' }, { name: 'Mobile' }];

    await tester.testAcrossPlatforms(platforms, async (platform) => {
      if (platform.name === 'Mobile') {
        return { violations: [{ rule: 'color-contrast', impact: 'serious' }] };
      }
      return { violations: [] };
    });

    const summary = tester.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.totalViolations).toBe(1);
  });
});

// ── Compatibility Reporting ───────────────────────────────────────────────────

describe('Compatibility Test Reporting', () => {
  it('should aggregate results across all test categories', async () => {
    const reporter = createCompatibilityReporter();
    const tester = createCrossPlatformTester();

    const osResults = await tester.testAcrossOS(async () => ({ ok: true }));
    const deviceResults = await tester.testAcrossDevices(async () => ({ ok: true }));

    reporter.addReport('os', osResults);
    reporter.addReport('devices', deviceResults);

    const summary = reporter.getSummary();
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.categories).toContain('os');
    expect(summary.categories).toContain('devices');
    expect(summary.passRate).toContain('%');
  });

  it('should generate full compatibility matrix', async () => {
    const reporter = createCompatibilityReporter();
    const tester = createCrossPlatformTester();

    const osResults = await tester.testAcrossOS(async () => ({ ok: true }));
    reporter.addReport('os', osResults);

    const matrix = reporter.generateCompatibilityMatrix();
    expect(matrix.os).toBeDefined();
    expect(matrix.os.every((entry) => entry.status === 'PASS')).toBe(true);
  });

  it('should report failures in compatibility matrix', async () => {
    const reporter = createCompatibilityReporter();
    const tester = createCrossPlatformTester({
      osProfiles: [OS_PROFILES.windows, OS_PROFILES.linux],
    });

    const results = await tester.testAcrossOS(async (os) => {
      if (os.name === 'Linux') throw new Error('Linux-specific failure');
      return { ok: true };
    });

    reporter.addReport('os', results);
    const matrix = reporter.generateCompatibilityMatrix();
    const linuxEntry = matrix.os.find((e) => e.target === 'Linux');
    expect(linuxEntry.status).toBe('FAIL');
    expect(linuxEntry.detail).toContain('Linux-specific failure');
  });
});
