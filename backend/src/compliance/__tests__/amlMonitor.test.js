'use strict';

/**
 * Tests for AML alert persistence failure handling in amlMonitor.screenTransaction.
 *
 * Verifies that when Prisma alert persistence throws, the failure is not
 * silently swallowed: it is logged, pushed to the Redis DLQ, and counted
 * via the aml_alert_persistence_failures_total metric.
 */

const mockLoggerError = jest.fn();
const mockRedisRpush = jest.fn();
const mockRedisLpush = jest.fn();
const mockMetricInc = jest.fn();
const mockPrismaCreate = jest.fn();

jest.mock('../../utils/logger', () => ({
  error: (...args) => mockLoggerError(...args),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/redis', () => ({
  getClient: () => ({
    rpush: (...args) => mockRedisRpush(...args),
    lpush: (...args) => mockRedisLpush(...args),
  }),
}));

jest.mock('../../utils/metrics', () => ({
  amlAlertPersistenceFailures: { inc: (...args) => mockMetricInc(...args) },
}));

jest.mock('../../utils/prisma', () => ({
  aMLAlert: { create: (...args) => mockPrismaCreate(...args) },
}));

const { screenTransaction } = require('../amlMonitor');

describe('amlMonitor.screenTransaction alert persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not silently swallow database errors and stores failed alerts in the DLQ', async () => {
    const dbError = new Error('connection timeout');
    mockPrismaCreate.mockRejectedValue(dbError);
    mockRedisRpush.mockResolvedValue(1);

    const tx = {
      id: 'tx-123',
      senderId: 'user-456',
      amount: 25000,
      currency: 'USD',
      receiverId: 'user-789',
    };

    await expect(screenTransaction(tx)).resolves.not.toThrow();

    // The failure must be logged with structured context.
    expect(mockLoggerError).toHaveBeenCalled();
    const [logContext, logMessage] = mockLoggerError.mock.calls[0];
    expect(logMessage).toBe('compliance.aml_alert.persist_failed');
    expect(logContext).toMatchObject({ txId: 'tx-123' });
    expect(logContext.err).toBe(dbError);

    // The failed alert must be persisted to the durable Redis DLQ.
    expect(mockRedisRpush).toHaveBeenCalled();
    const [dlqKey, payload] = mockRedisRpush.mock.calls[0];
    expect(dlqKey).toBe('compliance:dlq:alerts');
    const parsed = JSON.parse(payload);
    expect(parsed).toMatchObject({
      transactionId: 'tx-123',
      userId: 'user-456',
    });

    // A critical metric must be emitted for operational alerting.
    expect(mockMetricInc).toHaveBeenCalled();
  });

  it('falls back to the audit file when Redis is unavailable', async () => {
    const dbError = new Error('foreign key violation');
    mockPrismaCreate.mockRejectedValue(dbError);
    mockRedisRpush.mockRejectedValue(new Error('redis down'));

    const tx = {
      id: 'tx-999',
      senderId: 'user-111',
      amount: 9000,
      currency: 'USD',
      receiverId: 'user-222',
    };

    await expect(screenTransaction(tx)).resolves.not.toThrow();

    expect(mockLoggerError).toHaveBeenCalled();
    expect(mockMetricInc).toHaveBeenCalled();
  });
});
