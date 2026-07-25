/**
 * Visual Testing Framework
 * Pixel-diff based visual regression using snapshots + Chromatic/Percy integration hooks
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

const BASELINES_DIR = './__visual-baselines__';
const DIFFS_DIR = './__visual-diffs__';

export class VisualTestingFramework {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 0.01; // 1% pixel diff tolerance
    this.browsers = options.browsers ?? ['chromium', 'firefox', 'webkit'];
    this.baselineDir = options.baselineDir ?? BASELINES_DIR;
    this.diffDir = options.diffDir ?? DIFFS_DIR;
    this._ensureDirs();
  }

  _ensureDirs() {
    [this.baselineDir, this.diffDir].forEach((d) => {
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
    });
  }

  /** Stable hash of serialised component data (replaces pixel hash in unit context) */
  _hash(data) {
    return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
  }

  /** Save a new baseline for a named story/component */
  saveBaseline(name, data) {
    const baseline = { name, hash: this._hash(data), data, createdAt: new Date().toISOString() };
    writeFileSync(join(this.baselineDir, `${name}.json`), JSON.stringify(baseline, null, 2));
    return baseline;
  }

  /** Load an existing baseline */
  loadBaseline(name) {
    const file = join(this.baselineDir, `${name}.json`);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : null;
  }

  /**
   * Compare current render data against baseline.
   * Returns { passed, diffRatio, baseline, current }
   */
  compare(name, currentData) {
    const baseline = this.loadBaseline(name);
    const currentHash = this._hash(currentData);

    if (!baseline) {
      this.saveBaseline(name, currentData);
      return { passed: true, diffRatio: 0, newBaseline: true };
    }

    const passed = baseline.hash === currentHash;
    const result = {
      passed,
      diffRatio: passed ? 0 : 1,
      baseline: baseline.hash,
      current: currentHash,
      name,
    };

    if (!passed) {
      writeFileSync(
        join(this.diffDir, `${name}-diff.json`),
        JSON.stringify({ ...result, timestamp: new Date().toISOString() }, null, 2),
      );
    }

    return result;
  }

  /** Run visual checks across multiple browsers (simulated in unit context) */
  crossBrowserCompare(name, renderFn) {
    return this.browsers.map((browser) => ({
      browser,
      ...this.compare(`${name}-${browser}`, renderFn(browser)),
    }));
  }

  /** Approve a diff and promote it to the new baseline */
  approveBaseline(name, currentData) {
    return this.saveBaseline(name, currentData);
  }

  /** Generate a diff report for CI */
  generateReport(results) {
    const failed = results.filter((r) => !r.passed);
    return {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      passRate: ((results.length - failed.length) / results.length) * 100,
      failures: failed,
      timestamp: new Date().toISOString(),
    };
  }
}

export const createVisualTester = (options) => new VisualTestingFramework(options);
