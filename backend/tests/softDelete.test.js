import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import prisma from '../src/db/client.js';

/**
 * softDelete.test.js
 *
 * The application client (db/client.js) is already built as:
 *   baseClient.$extends(createSoftDeleteExtension()).$extends(timeout)
 *
 * Importing that client directly means soft-delete behaviour is already wired
 * up — there is no separate "middleware setup" step needed in tests.
 *
 * The earlier import of `setupSoftDeleteMiddleware` referred to a function
 * that has never existed in softDelete.js; that import caused every test in
 * this suite to fail with TypeError before any assertion ran.  Fixed by
 * removing it and relying on the already-extended prisma client.
 */
describe('Soft Delete Middleware', () => {
  let testUserId;
  let testTransactionId;

  beforeAll(async () => {
    // Nothing to set up — soft-delete extension is already applied in
    // db/client.js via baseClient.$extends(createSoftDeleteExtension()).
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data (includeDeleted bypasses the soft-delete filter so
    // we also wipe any previously soft-deleted rows).
    await prisma.user.deleteMany({ where: {}, includeDeleted: true });
    await prisma.transaction.deleteMany({ where: {}, includeDeleted: true });
  });

  // ---------------------------------------------------------------------------
  describe('User Soft Delete', () => {
    it('should soft delete a user by setting deletedAt', async () => {
      const user = await prisma.user.create({
        data: { id: 'test-user-1', publicKey: 'test-key-1' },
      });
      testUserId = user.id;

      const deletedUser = await prisma.user.delete({ where: { id: testUserId } });

      expect(deletedUser.deletedAt).not.toBeNull();
      expect(deletedUser.id).toBe(testUserId);
    });

    it('should exclude soft-deleted users from normal queries', async () => {
      const user1 = await prisma.user.create({
        data: { id: 'test-user-2', publicKey: 'test-key-2' },
      });
      const user2 = await prisma.user.create({
        data: { id: 'test-user-3', publicKey: 'test-key-3' },
      });

      await prisma.user.delete({ where: { id: user1.id } });

      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0].id).toBe(user2.id);
    });

    it('should include soft-deleted users when includeDeleted flag is set', async () => {
      const user1 = await prisma.user.create({
        data: { id: 'test-user-4', publicKey: 'test-key-4' },
      });
      await prisma.user.create({
        data: { id: 'test-user-5', publicKey: 'test-key-5' },
      });

      await prisma.user.delete({ where: { id: user1.id } });

      const users = await prisma.user.findMany({ includeDeleted: true });
      expect(users).toHaveLength(2);
    });

    it('should not find soft-deleted user by ID in normal query', async () => {
      const user = await prisma.user.create({
        data: { id: 'test-user-6', publicKey: 'test-key-6' },
      });
      await prisma.user.delete({ where: { id: user.id } });

      const foundUser = await prisma.user.findUnique({ where: { id: user.id } });
      expect(foundUser).toBeNull();
    });

    it('should find soft-deleted user by ID with includeDeleted flag', async () => {
      const user = await prisma.user.create({
        data: { id: 'test-user-7', publicKey: 'test-key-7' },
      });
      await prisma.user.delete({ where: { id: user.id } });

      const foundUser = await prisma.user.findUnique({
        where: { id: user.id },
        includeDeleted: true,
      });
      expect(foundUser).not.toBeNull();
      expect(foundUser.deletedAt).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  describe('Transaction Soft Delete', () => {
    it('should soft delete a transaction by setting deletedAt', async () => {
      const user = await prisma.user.create({
        data: { id: 'test-user-8', publicKey: 'test-key-8' },
      });
      const transaction = await prisma.transaction.create({
        data: {
          id: 'test-tx-1',
          hash: 'test-hash-1',
          senderId: user.id,
          recipientId: user.id,
          amount: 100,
        },
      });
      testTransactionId = transaction.id;

      const deletedTx = await prisma.transaction.delete({
        where: { id: testTransactionId },
      });
      expect(deletedTx.deletedAt).not.toBeNull();
      expect(deletedTx.id).toBe(testTransactionId);
    });

    it('should exclude soft-deleted transactions from normal queries', async () => {
      const user = await prisma.user.create({
        data: { id: 'test-user-9', publicKey: 'test-key-9' },
      });
      const tx1 = await prisma.transaction.create({
        data: {
          id: 'test-tx-2',
          hash: 'test-hash-2',
          senderId: user.id,
          recipientId: user.id,
          amount: 100,
        },
      });
      const tx2 = await prisma.transaction.create({
        data: {
          id: 'test-tx-3',
          hash: 'test-hash-3',
          senderId: user.id,
          recipientId: user.id,
          amount: 200,
        },
      });

      await prisma.transaction.delete({ where: { id: tx1.id } });

      const transactions = await prisma.transaction.findMany();
      expect(transactions).toHaveLength(1);
      expect(transactions[0].id).toBe(tx2.id);
    });

    it('should include soft-deleted transactions when includeDeleted flag is set', async () => {
      const user = await prisma.user.create({
        data: { id: 'test-user-10', publicKey: 'test-key-10' },
      });
      const tx1 = await prisma.transaction.create({
        data: {
          id: 'test-tx-4',
          hash: 'test-hash-4',
          senderId: user.id,
          recipientId: user.id,
          amount: 100,
        },
      });
      await prisma.transaction.create({
        data: {
          id: 'test-tx-5',
          hash: 'test-hash-5',
          senderId: user.id,
          recipientId: user.id,
          amount: 200,
        },
      });

      await prisma.transaction.delete({ where: { id: tx1.id } });

      const transactions = await prisma.transaction.findMany({ includeDeleted: true });
      expect(transactions).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  describe('Audit Trail Compliance', () => {
    it('should preserve transaction history after user soft delete', async () => {
      const user = await prisma.user.create({
        data: { id: 'test-user-11', publicKey: 'test-key-11' },
      });
      const transaction = await prisma.transaction.create({
        data: {
          id: 'test-tx-6',
          hash: 'test-hash-6',
          senderId: user.id,
          recipientId: user.id,
          amount: 100,
        },
      });

      await prisma.user.delete({ where: { id: user.id } });

      const tx = await prisma.transaction.findUnique({
        where: { id: transaction.id },
        includeDeleted: true,
      });
      expect(tx).not.toBeNull();
      expect(tx.senderId).toBe(user.id);
    });

    it('should maintain deletedAt timestamp for compliance audits', async () => {
      const user = await prisma.user.create({
        data: { id: 'test-user-12', publicKey: 'test-key-12' },
      });

      const beforeDelete = new Date();
      const deletedUser = await prisma.user.delete({ where: { id: user.id } });
      const afterDelete = new Date();

      expect(deletedUser.deletedAt).not.toBeNull();
      expect(deletedUser.deletedAt.getTime()).toBeGreaterThanOrEqual(beforeDelete.getTime());
      expect(deletedUser.deletedAt.getTime()).toBeLessThanOrEqual(afterDelete.getTime());
    });

    it('getFeeHistory never returns more points than real persisted snapshots', async () => {
      // Acceptance criterion from issue #1119: the returned history length must
      // never exceed the number of FeeSnapshot rows in the requested window.
      const { getFeeHistory } = await import('../src/services/feeHistory.js');

      // With a clean DB (no snapshots) the history must be empty, not fabricated.
      const result = await getFeeHistory(24);
      const dbCount = await prisma.feeSnapshot.count();

      expect(result.history.length).toBeLessThanOrEqual(dbCount);
      expect(result.history.length).toBe(dbCount); // must match exactly
    });
  });
});