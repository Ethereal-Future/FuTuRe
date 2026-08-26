/**
 * @deprecated Use dom-snapshot-tester.js instead
 * This module performs DOM/content snapshotting via hashing, not pixel-level visual regression.
 * For actual visual regression testing, see e2e/tests/visual-regression.spec.js
 */

import { DomSnapshotTester, createDomSnapshotTest } from './dom-snapshot-tester.js';

export class VisualRegressionTester extends DomSnapshotTester {
  constructor(testName) {
    super(testName);
    console.warn(
      'VisualRegressionTester is deprecated. Use DomSnapshotTester from dom-snapshot-tester.js instead.'
    );
  }
}

export const createVisualRegressionTest = (testName) => {
  console.warn(
    'createVisualRegressionTest is deprecated. Use createDomSnapshotTest from dom-snapshot-tester.js instead.'
  );
  return new VisualRegressionTester(testName);
};

export { DomSnapshotTester, createDomSnapshotTest };
