/**
 * Tests for ISSUE-062: atomic admin audit log
 *
 * WARNING: Do NOT run these tests against a production database.
 * All Prisma interactions are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared mock state ─────────────────────────────────────────────────────────
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock('../src/db/client.js', () => ({
  default: {
    adminAuditLog: { create: mockCreate },
    kYCRecord: { update: mockUpdate },
    $transaction: mockTransaction,
  },
}));

vi.mock('../src/config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logAdminAction } from '../src/db/adminAuditLog.js';

// ── logAdminAction unit tests ─────────────────────────────────────────────────

describe('ISSUE-062: logAdminAction atomicity', () => {
  beforeEach(() => vi.clearAllMocks());

  const BASE_ARGS = ['admin-1', 'KYC_APPROVE', 'USER', 'user-42', {}, {}];

  describe('without transaction (standalone / fire-and-forget)', () => {
    it('writes the audit record via the singleton prisma client', async () => {
      mockCreate.mockResolvedValue({ id: 'log-1' });

      await logAdminAction(...BASE_ARGS);

      expect(mockCreate).toHaveBeenCalledOnce();
      const data = mockCreate.mock.calls[0][0].data;
      expect(data.adminUserId).toBe('admin-1');
      expect(data.actionType).toBe('KYC_APPROVE');
    });

    it('swallows errors to avoid disrupting the HTTP response', async () => {
      mockCreate.mockRejectedValue(new Error('DB down'));

      // Must NOT throw
      await expect(logAdminAction(...BASE_ARGS)).resolves.toBeUndefined();
    });
  });

  describe('with transaction client (atomic mode)', () => {
    it('writes the audit record via the provided tx client', async () => {
      const txCreate = vi.fn().mockResolvedValue({ id: 'log-2' });
      const tx = { adminAuditLog: { create: txCreate } };

      await logAdminAction(...BASE_ARGS, tx);

      expect(txCreate).toHaveBeenCalledOnce();
      // Singleton client must NOT have been used
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('propagates errors so the transaction rolls back', async () => {
      const txCreate = vi.fn().mockRejectedValue(new Error('constraint violation'));
      const tx = { adminAuditLog: { create: txCreate } };

      await expect(logAdminAction(...BASE_ARGS, tx)).rejects.toThrow('constraint violation');
    });

    it('includes ip and user-agent from the request object', async () => {
      const txCreate = vi.fn().mockResolvedValue({});
      const tx = { adminAuditLog: { create: txCreate } };
      const req = { ip: '1.2.3.4', get: (h) => (h === 'user-agent' ? 'TestAgent/1.0' : null) };

      await logAdminAction('admin-2', 'KYC_REJECT', 'USER', 'user-99', { reason: 'fraud' }, req, tx);

      const data = txCreate.mock.calls[0][0].data;
      expect(data.ipAddress).toBe('1.2.3.4');
      expect(data.userAgent).toBe('TestAgent/1.0');
      expect(data.actionMetadata).toEqual({ reason: 'fraud' });
    });
  });

  describe('atomicity invariants', () => {
    it('if audit log insert fails inside a tx, caller can observe the rejection', async () => {
      // Model the full prisma.$transaction behaviour: if any step rejects,
      // the whole callback rejects and the caller gets the error.
      mockTransaction.mockImplementation(async (cb) => {
        const tx = {
          kYCRecord: {
            update: mockUpdate.mockResolvedValue({ status: 'APPROVED' }),
          },
          adminAuditLog: {
            create: vi.fn().mockRejectedValue(new Error('audit insert failed')),
          },
        };
        return cb(tx);
      });

      const prisma = (await import('../src/db/client.js')).default;

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.kYCRecord.update({ where: { userId: 'u1' }, data: { status: 'APPROVED' } });
          await logAdminAction('admin-1', 'KYC_APPROVE', 'USER', 'u1', {}, {}, tx);
        })
      ).rejects.toThrow('audit insert failed');
    });

    it('if business update fails inside a tx, audit log is never written', async () => {
      const auditCreate = vi.fn();

      mockTransaction.mockImplementation(async (cb) => {
        const tx = {
          kYCRecord: {
            update: vi.fn().mockRejectedValue(new Error('update failed')),
          },
          adminAuditLog: { create: auditCreate },
        };
        return cb(tx);
      });

      const prisma = (await import('../src/db/client.js')).default;

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.kYCRecord.update({ where: { userId: 'u1' }, data: { status: 'APPROVED' } });
          await logAdminAction('admin-1', 'KYC_APPROVE', 'USER', 'u1', {}, {}, tx);
        })
      ).rejects.toThrow('update failed');

      expect(auditCreate).not.toHaveBeenCalled();
    });
  });
});
