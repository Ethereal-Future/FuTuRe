import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import prisma from '../src/db/client.js';
import { setupSoftDeleteMiddleware } from '../src/db/softDelete.js';

describe('Soft Delete Middleware', () => {
  let testUserId;
  let testTransactionId;

  beforeAll(async () => {
    // Ensure middleware is set up
    setupSoftDeleteMiddleware(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up test data
    await prisma.user.deleteMany({ includeDeleted: true });
    await prisma.transaction.deleteMany({ includeDeleted: true });
  });

  describe('User Soft Delete', () => {
    it('should soft delete a user by setting deletedAt', async () => {
      // Create a test user
      const user = await prisma.user.create({
        data: {
          id: 'test-user-1',
          publicKey: 'test-key-1',
        },
      });
      testUserId = user.id;

      // Soft delete the user
      const deletedUser = await prisma.user.delete({
        where: { id: testUserId },
      });

      expect(deletedUser.deletedAt).not.toBeNull();
      expect(deletedUser.id).toBe(testUserId);
    });

    it('should exclude soft-deleted users from normal queries', async () => {
      // Create two users
      const user1 = await prisma.user.create({
        data: {
          id: 'test-user-2',
          publicKey: 'test-key-2',
        },
      });

      const user2 = await prisma.user.create({
        data: {
          id: 'test-user-3',
          publicKey: 'test-key-3',
        },
      });

      // Soft delete user1
      await prisma.user.delete({
        where: { id: user1.id },
      });

      // Query all users - should only return user2
      const users = await prisma.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0].id).toBe(user2.id);
    });

    it('should include soft-deleted users when includeDeleted flag is set', async () => {
      // Create two users
      const user1 = await prisma.user.create({
        data: {
          id: 'test-user-4',
          publicKey: 'test-key-4',
        },
      });

      const user2 = await prisma.user.create({
        data: {
          id: 'test-user-5',
          publicKey: 'test-key-5',
        },
      });

      // Soft delete user1
      await prisma.user.delete({
        where: { id: user1.id },
      });

      // Query with includeDeleted flag - should return both users
      const users = await prisma.user.findMany({
        includeDeleted: true,
      });
      expect(users).toHaveLength(2);
    });

    it('should not find soft-deleted user by ID in normal query', async () => {
      // Create and soft delete a user
      const user = await prisma.user.create({
        data: {
          id: 'test-user-6',
          publicKey: 'test-key-6',
        },
      });

      await prisma.user.delete({
        where: { id: user.id },
      });

      // Try to find the deleted user - should return null
      const foundUser = await prisma.user.findUnique({
        where: { id: user.id },
      });
      expect(foundUser).toBeNull();
    });

    it('should find soft-deleted user by ID with includeDeleted flag', async () => {
      // Create and soft delete a user
      const user = await prisma.user.create({
        data: {
          id: 'test-user-7',
          publicKey: 'test-key-7',
        },
      });

      await prisma.user.delete({
        where: { id: user.id },
      });

      // Find the deleted user with includeDeleted flag
      const foundUser = await prisma.user.findUnique({
        where: { id: user.id },
        includeDeleted: true,
      });
      expect(foundUser).not.toBeNull();
      expect(foundUser.deletedAt).not.toBeNull();
    });
  });

  describe('Transaction Soft Delete', () => {
    it('should soft delete a transaction by setting deletedAt', async () => {
      // Create a test user first
      const user = await prisma.user.create({
        data: {
          id: 'test-user-8',
          publicKey: 'test-key-8',
        },
      });

      // Create a transaction
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

      // Soft delete the transaction
      const deletedTx = await prisma.transaction.delete({
        where: { id: testTransactionId },
      });

      expect(deletedTx.deletedAt).not.toBeNull();
      expect(deletedTx.id).toBe(testTransactionId);
    });

    it('should exclude soft-deleted transactions from normal queries', async () => {
      // Create a test user
      const user = await prisma.user.create({
        data: {
          id: 'test-user-9',
          publicKey: 'test-key-9',
        },
      });

      // Create two transactions
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

      // Soft delete tx1
      await prisma.transaction.delete({
        where: { id: tx1.id },
      });

      // Query all transactions - should only return tx2
      const transactions = await prisma.transaction.findMany();
      expect(transactions).toHaveLength(1);
      expect(transactions[0].id).toBe(tx2.id);
    });

    it('should include soft-deleted transactions when includeDeleted flag is set', async () => {
      // Create a test user
      const user = await prisma.user.create({
        data: {
          id: 'test-user-10',
          publicKey: 'test-key-10',
        },
      });

      // Create two transactions
      const tx1 = await prisma.transaction.create({
        data: {
          id: 'test-tx-4',
          hash: 'test-hash-4',
          senderId: user.id,
          recipientId: user.id,
          amount: 100,
        },
      });

      const tx2 = await prisma.transaction.create({
        data: {
          id: 'test-tx-5',
          hash: 'test-hash-5',
          senderId: user.id,
          recipientId: user.id,
          amount: 200,
        },
      });

      // Soft delete tx1
      await prisma.transaction.delete({
        where: { id: tx1.id },
      });

      // Query with includeDeleted flag - should return both transactions
      const transactions = await prisma.transaction.findMany({
        includeDeleted: true,
      });
      expect(transactions).toHaveLength(2);
    });
  });

  describe('Audit Trail Compliance', () => {
    it('should preserve transaction history after user soft delete', async () => {
      // Create a user
      const user = await prisma.user.create({
        data: {
          id: 'test-user-11',
          publicKey: 'test-key-11',
        },
      });

      // Create a transaction
      const transaction = await prisma.transaction.create({
        data: {
          id: 'test-tx-6',
          hash: 'test-hash-6',
          senderId: user.id,
          recipientId: user.id,
          amount: 100,
        },
      });

      // Soft delete the user
      await prisma.user.delete({
        where: { id: user.id },
      });

      // Transaction should still be accessible with includeDeleted flag
      const tx = await prisma.transaction.findUnique({
        where: { id: transaction.id },
        includeDeleted: true,
      });
      expect(tx).not.toBeNull();
      expect(tx.senderId).toBe(user.id);
    });

    it('should maintain deletedAt timestamp for compliance audits', async () => {
      // Create a user
      const user = await prisma.user.create({
        data: {
          id: 'test-user-12',
          publicKey: 'test-key-12',
        },
      });

      const beforeDelete = new Date();

      // Soft delete the user
      const deletedUser = await prisma.user.delete({
        where: { id: user.id },
      });

      const afterDelete = new Date();

      // Verify deletedAt is set and within expected time range
      expect(deletedUser.deletedAt).not.toBeNull();
      expect(deletedUser.deletedAt.getTime()).toBeGreaterThanOrEqual(beforeDelete.getTime());
      expect(deletedUser.deletedAt.getTime()).toBeLessThanOrEqual(afterDelete.getTime());
    });
  });
});
