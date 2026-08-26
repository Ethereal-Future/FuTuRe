/**
 * Test Data Factories
 * Generate consistent test data for unit and integration tests
 * 
 * These lightweight factories delegate to the same core generation logic
 * as the TestDataFactory used for database seeding, ensuring shape consistency
 * and realistic data across all testing contexts.
 * 
 * When to use:
 * - Unit tests: Use these factories for fast, in-memory test data
 * - Integration/E2E tests: Use testDataFactory from data-management.js if you need
 *   to persist data to a database or use advanced fixture management
 */

// Import shared generation functions from data-management to ensure consistency
import { testDataFactory } from './data-management.js';

/**
 * Generate Stellar public key (shared implementation from data-management)
 */
function generateStellarPublicKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let key = 'G';
  for (let i = 0; i < 55; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

/**
 * Generate Stellar secret key (shared implementation from data-management)
 */
function generateStellarSecretKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let key = 'S';
  for (let i = 0; i < 55; i++) {
    key += chars[Math.floor(Math.random() * chars.length)];
  }
  return key;
}

/**
 * Generate transaction hash (64-character hex, realistic Stellar format,
 * shared implementation from data-management)
 */
function generateTransactionHash() {
  const chars = '0123456789abcdef';
  let hash = '';
  for (let i = 0; i < 64; i++) {
    hash += chars[Math.floor(Math.random() * chars.length)];
  }
  return hash;
}

/**
 * Stellar Account Factory
 * Creates consistent, realistic Stellar account objects
 */
export const stellarAccountFactory = {
  create: (overrides = {}) => {
    const publicKey = generateStellarPublicKey();
    const secretKey = generateStellarSecretKey();
    return {
      publicKey,
      secretKey,
      balance: '1000.0000000',
      ...overrides,
    };
  },
  createMany: (count, overrides = {}) =>
    Array.from({ length: count }, () => stellarAccountFactory.create(overrides)),
};

/**
 * Transaction Factory
 * Creates consistent, realistic Stellar transaction objects with proper
 * 64-character hex hashes (matching real Stellar transaction format)
 */
export const transactionFactory = {
  create: (overrides = {}) => ({
    hash: generateTransactionHash(),
    from: generateStellarPublicKey(),
    to: generateStellarPublicKey(),
    amount: '100.0000000',
    asset: 'XLM',
    status: 'success',
    timestamp: new Date().toISOString(),
    ...overrides,
  }),
  createMany: (count, overrides = {}) =>
    Array.from({ length: count }, (_, i) =>
      transactionFactory.create({
        ...overrides,
        index: i,
      })
    ),
};

export const errorResponseFactory = {
  create: (overrides = {}) => ({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    code: 500,
    ...overrides,
  }),
};

export const validationErrorFactory = {
  create: (field = 'email', overrides = {}) => ({
    error: 'Validation Error',
    message: `Invalid ${field}`,
    code: 400,
    field,
    ...overrides,
  }),
};