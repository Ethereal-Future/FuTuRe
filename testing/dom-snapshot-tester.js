/**
 * DOM Snapshot Testing Utilities
 * Captures and compares HTML/DOM structure changes via content hashing.
 * This is a structural regression detector, not pixel-level visual regression.
 * For pixel-level testing, use the Playwright visual regression suite in e2e/tests/visual-regression.spec.js
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { redactSensitiveData } from './privacy.js';

const SNAPSHOTS_DIR = './__snapshots__';

export class DomSnapshotTester {
  constructor(testName) {
    this.testName = testName;
    this.snapshotPath = join(SNAPSHOTS_DIR, `${testName}.snapshot.json`);
    this.ensureSnapshotDir();
  }

  ensureSnapshotDir() {
    if (!existsSync(SNAPSHOTS_DIR)) {
      mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    }
  }

  captureSnapshot(data) {
    const sanitized = redactSensitiveData(data);
    return {
      timestamp: new Date().toISOString(),
      hash: this.hashData(sanitized),
      data: sanitized,
    };
  }

  hashData(data) {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  saveSnapshot(data) {
    const snapshot = this.captureSnapshot(data);
    writeFileSync(this.snapshotPath, JSON.stringify(snapshot, null, 2));
    return snapshot;
  }

  loadSnapshot() {
    if (!existsSync(this.snapshotPath)) {
      return null;
    }
    return JSON.parse(readFileSync(this.snapshotPath, 'utf-8'));
  }

  compareSnapshot(data) {
    const current = this.captureSnapshot(data);
    const previous = this.loadSnapshot();

    if (!previous) {
      return { match: false, reason: 'No previous snapshot found' };
    }

    return {
      match: current.hash === previous.hash,
      current: current.hash,
      previous: previous.hash,
    };
  }
}

export const createDomSnapshotTest = (testName) => {
  return new DomSnapshotTester(testName);
};
