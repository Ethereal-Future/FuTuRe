/**
 * Main Testing Utilities Export
 * Centralized access to all testing utilities
 * 
 * Factory Guide:
 * 
 * 1. Lightweight factories (stellarAccountFactory, transactionFactory, etc.) - from './factories.js'
 *    - Use for unit tests: Fast, in-memory generation of test data
 *    - No async operations, ideal for isolated unit testing
 *    - Generates the same realistic data format as the database seeding factories
 * 
 * 2. TestDataFactory / TestDataManager - from './data-management.js'
 *    - Use for integration/E2E tests: When you need to persist data to a database
 *    - Provides advanced features: fixture management, database seeding, snapshots
 *    - Exports: testDataFactory, testDataManager
 */

export * from './factories.js';
export * from './environment.js';
export * from './testnetAccount.js';
export * from './dom-snapshot-tester.js';
export * from './visual-regression.js';
export * from './accessibility.js';
export * from './cross-browser.js';
export * from './reporter.js';
export * from './parallelization.js';
export * from './privacy.js';
export { testDataFactory, testDataManager } from './data-management.js';