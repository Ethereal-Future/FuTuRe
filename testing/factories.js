/**
 * Test Data Factories
 * Generate consistent test data for unit and integration tests
 */

import { fakeStellarKeypair, fakeStellarPublicKey } from './privacy.js';

export const stellarAccountFactory = {
  create: (overrides = {}) => {
    const { publicKey, secretKey } = fakeStellarKeypair();
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

export const transactionFactory = {
  create: (overrides = {}) => ({
    id: 'tx-' + Math.random().toString(36).substr(2, 9),
    from: fakeStellarPublicKey(),
    to: fakeStellarPublicKey(),
    amount: '100.0000000',
    asset: 'native',
    status: 'success',
    timestamp: new Date().toISOString(),
    ...overrides,
  }),
  createMany: (count, overrides = {}) =>
    Array.from({ length: count }, (_, i) =>
      transactionFactory.create({
        id: `tx-${i}`,
        ...overrides,
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
