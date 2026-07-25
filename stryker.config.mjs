// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  reporters: ['html', 'clear-text', 'progress', 'json'],
  testRunner: 'vitest',
  // Target critical path source files only
  mutate: [
    'frontend/src/utils/validateAmount.js',
    'frontend/src/utils/formatBalance.js',
    'frontend/src/utils/errorMessages.js',
    'frontend/src/utils/validateStellarAddress.js',
    'backend/src/services/*.js',
  ],
  vitest: {
    configFile: 'vitest.mutation.config.js',
  },
  coverageAnalysis: 'perTest',
  // Thresholds rationale:
  //   break: 50 — CI hard-fails below 50%; at this level more than half of all
  //               mutations survive, indicating the suite is not meaningfully
  //               exercising the mutated code paths.
  //   low:   60 — Scores in [50, 60) are flagged as poor; reviewers should add
  //               tests before merging new code in this range.
  //   high:  80 — Target score; scores above this are considered acceptable for
  //               the current critical-path scope (validation, formatting, services).
  //               Raise incrementally as coverage improves.
  thresholds: {
    high: 80,
    low: 60,
    break: 50,
  },
  htmlReporter: {
    fileName: 'mutation-reports/mutation-report.html',
  },
  jsonReporter: {
    fileName: 'mutation-reports/mutation-report.json',
  },
  timeoutMS: 10000,
  timeoutFactor: 1.5,
  concurrency: 4,
  disableTypeChecks: true,
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    'mutation-reports',
    'mobile-tests',
    'migration-logs',
    'test-reports',
    '.stryker-tmp',
  ],
};
