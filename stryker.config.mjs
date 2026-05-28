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
  ],
  vitest: {
    configFile: 'vitest.mutation.config.js',
  },
  coverageAnalysis: 'perTest',
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
