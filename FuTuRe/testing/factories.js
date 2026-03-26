/**
 * Test Data Factories
 * Generate consistent test data for unit and integration tests
 */

export const stellarAccountFactory = {
  create: (overrides = {}) => ({
    publicKey: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H',
    secretKey: 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH',
    balance: '1000.0000000',
    ...overrides,
  }),
  createMany: (count, overrides = {}) =>
    Array.from({ length: count }, (_, i) =>
      stellarAccountFactory.create({
        publicKey: `GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP${String(i).padStart(2, '0')}`,
        ...overrides,
      })
    ),
};

export const transactionFactory = {
  create: (overrides = {}) => ({
    id: 'tx-' + Math.random().toString(36).substr(2, 9),
    from: 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H',
    to: 'GBXIJJGUJJBBX7IXLMQVVXTNQRYUOP7HGHJHGBRPYHIL2CI3WHZDTOOQFC6',
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
