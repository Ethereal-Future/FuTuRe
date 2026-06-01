import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkTransaction } from '../src/compliance/amlMonitor.js';
import prisma from '../src/db/client.js';
import complianceRouter from '../src/routes/compliance.js';

vi.mock('../src/db/client.js', () => ({
  default: {
    transaction: {
      findMany: vi.fn(),
    },
    aMLAlert: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../src/config/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AML Monitor Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should flag structuring when user sends >3 transactions in 24h each below $1000', async () => {
    const mockTransactions = [
      { id: 'tx-1', userId: 'user-1', amount: '100', createdAt: new Date() },
      { id: 'tx-2', userId: 'user-1', amount: '200', createdAt: new Date() },
      { id: 'tx-3', userId: 'user-1', amount: '300', createdAt: new Date() },
    ];

    prisma.transaction.findMany.mockResolvedValue(mockTransactions);

    const newTx = { id: 'tx-4', userId: 'user-1', amount: '400', createdAt: new Date() };
    await checkTransaction(newTx);

    expect(prisma.aMLAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          rule: 'STRUCTURING',
          severity: 'HIGH',
        }),
      })
    );
  });

  it('should not flag structuring when transactions are above $1000', async () => {
    const mockTransactions = [
      { id: 'tx-1', userId: 'user-1', amount: '1500', createdAt: new Date() },
      { id: 'tx-2', userId: 'user-1', amount: '2000', createdAt: new Date() },
    ];

    prisma.transaction.findMany.mockResolvedValue(mockTransactions);

    const newTx = { id: 'tx-3', userId: 'user-1', amount: '1200', createdAt: new Date() };
    await checkTransaction(newTx);

    expect(prisma.aMLAlert.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rule: 'STRUCTURING',
        }),
      })
    );
  });

  it('should flag velocity when total sent in 24h exceeds $10,000', async () => {
    const mockTransactions = [
      { id: 'tx-1', userId: 'user-1', amount: '5000', createdAt: new Date() },
      { id: 'tx-2', userId: 'user-1', amount: '4000', createdAt: new Date() },
    ];

    prisma.transaction.findMany.mockResolvedValue(mockTransactions);

    const newTx = { id: 'tx-3', userId: 'user-1', amount: '2000', createdAt: new Date() };
    await checkTransaction(newTx);

    expect(prisma.aMLAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          rule: 'VELOCITY',
          severity: 'CRITICAL',
        }),
      })
    );
  });
});

describe('Compliance API Route Handler', () => {
  it('should return 403 if user is not an admin', async () => {
    const req = {
      user: { role: 'USER' },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const route = complianceRouter.stack.find(s => s.route && s.route.path === '/aml-alerts');
    const handler = route.route.stack[route.route.stack.length - 1].handle;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('should return alerts if user is an admin', async () => {
    const req = {
      user: { role: 'ADMIN' },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const mockAlerts = [{ id: 'alert-1', rule: 'STRUCTURING' }];
    prisma.aMLAlert.findMany.mockResolvedValue(mockAlerts);

    const route = complianceRouter.stack.find(s => s.route && s.route.path === '/aml-alerts');
    const handler = route.route.stack[route.route.stack.length - 1].handle;

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith(mockAlerts);
  });
});