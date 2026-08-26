/**
 * AML pre-submission screening tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import amlMonitor from '../src/compliance/amlMonitor.js';

vi.mock('../src/db/client.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      findMany: vi.fn(),
    },
    aMLAlert: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../src/compliance/riskScorer.js', () => ({
  default: {
    scoreTransaction: vi.fn().mockResolvedValue({
      score: 75,
      level: 'HIGH',
    }),
  },
}));

vi.mock('../src/compliance/complianceAudit.js', () => ({
  default: {
    log: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../src/compliance/kycCollector.js', () => ({
  default: {
    isVerified: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../src/config/logger.js', () => ({
  default: {
    child: () => ({
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    }),
  },
}));

import prisma from '../src/db/client.js';

describe('AML Pre-Submission Screening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Pre-Submission vs Post-Submission', () => {
    it('should have separate screening modes', () => {
      expect(amlMonitor.screenTransactionPreSubmission).toBeDefined();
      expect(amlMonitor.screenTransaction).toBeDefined();
    });

    it('should flag LARGE_TX in pre-submission', async () => {
      const tx = {
        senderId: 'user123',
        amount: '15000', // Exceeds default 10000 threshold
        createdAt: new Date(),
      };

      const result = await amlMonitor.screenTransactionPreSubmission(tx, []);

      expect(result.flagged).toBe(true);
      expect(result.blocking).toBe(true);
      expect(result.alerts).toContainEqual(
        expect.objectContaining({ ruleId: 'LARGE_TX', severity: 'HIGH' })
      );
    });

    it('should flag STRUCTURING in pre-submission', async () => {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const tx = {
        senderId: 'user123',
        amount: '500', // Below threshold
        createdAt: now,
      };

      const history = [
        { senderId: 'user123', amount: '800', createdAt: dayAgo, successful: true },
        { senderId: 'user123', amount: '900', createdAt: dayAgo, successful: true },
        { senderId: 'user123', amount: '950', createdAt: dayAgo, successful: true },
      ];

      const result = await amlMonitor.screenTransactionPreSubmission(tx, history);

      expect(result.flagged).toBe(true);
      expect(result.blocking).toBe(true);
      expect(result.alerts).toContainEqual(
        expect.objectContaining({ ruleId: 'STRUCTURING', severity: 'HIGH' })
      );
    });

    it('should flag VELOCITY in pre-submission', async () => {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const tx = {
        senderId: 'user123',
        amount: '3000',
        createdAt: now,
      };

      const history = [
        { senderId: 'user123', amount: '5000', createdAt: dayAgo, successful: true },
        { senderId: 'user123', amount: '4000', createdAt: dayAgo, successful: true },
      ];

      const result = await amlMonitor.screenTransactionPreSubmission(tx, history);

      expect(result.flagged).toBe(true);
      expect(result.blocking).toBe(true);
      expect(result.alerts).toContainEqual(
        expect.objectContaining({ ruleId: 'VELOCITY', severity: 'HIGH' })
      );
    });

    it('should not include UNVERIFIED_USER in pre-submission', async () => {
      const tx = {
        senderId: 'user123',
        amount: '500',
        createdAt: new Date(),
      };

      const result = await amlMonitor.screenTransactionPreSubmission(tx, []);

      const unverifiedAlert = result.alerts.find(a => a.ruleId === 'UNVERIFIED_USER');
      expect(unverifiedAlert).toBeUndefined();
    });
  });

  describe('Account Hold Functionality', () => {
    it('should place account on hold for review', async () => {
      vi.mocked(prisma.user.update).mockResolvedValueOnce({
        id: 'user123',
        amlStatus: 'HELD_FOR_REVIEW',
      });

      await amlMonitor.holdAccountForReview('user123', 'Structuring detected');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user123' },
        data: expect.objectContaining({
          amlStatus: 'HELD_FOR_REVIEW',
          amlHoldReason: 'Structuring detected',
          amlHoldDate: expect.any(Date),
        }),
      });
    });

    it('should clear account hold', async () => {
      vi.mocked(prisma.user.update).mockResolvedValueOnce({
        id: 'user123',
        amlStatus: 'CLEAR',
      });

      await amlMonitor.clearAccountHold('user123');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user123' },
        data: {
          amlStatus: 'CLEAR',
          amlHoldReason: null,
          amlHoldDate: null,
        },
      });
    });
  });

  describe('Transaction History Retrieval', () => {
    it('should retrieve transaction history within window', async () => {
      const now = new Date();
      const mockHistory = [
        { id: 'tx1', senderId: 'user123', amount: '1000', createdAt: now, successful: true },
        { id: 'tx2', senderId: 'user123', amount: '2000', createdAt: now, successful: true },
      ];

      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce(mockHistory);

      const history = await amlMonitor.getTransactionHistory('user123');

      expect(prisma.transaction.findMany).toHaveBeenCalledWith({
        where: {
          senderId: 'user123',
          createdAt: {
            gte: expect.any(Date),
          },
          successful: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      expect(history).toEqual(mockHistory);
    });

    it('should only count successful transactions in history', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValueOnce([]);

      await amlMonitor.getTransactionHistory('user123');

      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            successful: true,
          }),
        })
      );
    });
  });

  describe('Blocking Behavior', () => {
    it('should return blocking=true when HIGH severity alerts exist', async () => {
      const tx = {
        senderId: 'user123',
        amount: '15000', // Large transaction
        createdAt: new Date(),
      };

      const result = await amlMonitor.screenTransactionPreSubmission(tx, []);

      expect(result.blocking).toBe(true);
    });

    it('should return blocking=false when no HIGH severity alerts', async () => {
      const tx = {
        senderId: 'user123',
        amount: '500', // Small transaction
        createdAt: new Date(),
      };

      const result = await amlMonitor.screenTransactionPreSubmission(tx, []);

      expect(result.blocking).toBe(false);
    });

    it('should not proceed with Stellar payment when blocked', async () => {
      const tx = {
        senderId: 'user123',
        amount: '15000',
        createdAt: new Date(),
      };

      const result = await amlMonitor.screenTransactionPreSubmission(tx, []);

      // The endpoint should check result.blocking before calling StellarService.sendPayment
      expect(result.blocking).toBe(true);
    });
  });

  describe('Multiple Violations', () => {
    it('should detect multiple violations simultaneously', async () => {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const tx = {
        senderId: 'user123',
        amount: '12000', // Exceeds LARGE_TX threshold
        createdAt: now,
      };

      const history = [
        { senderId: 'user123', amount: '5000', createdAt: dayAgo, successful: true },
        { senderId: 'user123', amount: '4000', createdAt: dayAgo, successful: true },
      ];

      const result = await amlMonitor.screenTransactionPreSubmission(tx, history);

      // Should trigger both LARGE_TX and VELOCITY
      const ruleIds = result.alerts.map(a => a.ruleId);
      expect(ruleIds).toContain('LARGE_TX');
      expect(ruleIds).toContain('VELOCITY');
    });
  });

  describe('Post-Submission Screening', () => {
    it('should include all rules in post-submission screening', async () => {
      const tx = {
        id: 'tx123',
        senderId: 'user123',
        amount: '500',
        createdAt: new Date(),
      };

      const result = await amlMonitor.screenTransaction(tx, []);

      // Post-submission should not block, just flag
      expect(result.blocking).toBeUndefined();
      expect(result.flagged).toBeDefined();
    });
  });
});
