import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as userStore from '../src/auth/userStore.js';
import prisma from '../src/db/client.js';

vi.mock('../src/db/client.js');

describe('User Store - Prisma Persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createUser', () => {
    it('should create a new user with username and passwordHash', async () => {
      const mockUser = { id: 'user-1', username: 'testuser', passwordHash: 'hash123' };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.user.create).mockResolvedValue(mockUser);

      const result = await userStore.createUser('testuser', 'hash123');

      expect(result).toEqual({ id: 'user-1', username: 'testuser' });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ username: 'testuser', passwordHash: 'hash123' }),
      });
    });

    it('should throw error if user already exists', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1', username: 'testuser' });

      await expect(userStore.createUser('testuser', 'hash123')).rejects.toThrow('User already exists');
    });
  });

  describe('findUser', () => {
    it('should find user by username', async () => {
      const mockUser = { id: 'user-1', username: 'testuser', passwordHash: 'hash123' };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);

      const result = await userStore.findUser('testuser');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { username: 'testuser' } });
    });

    it('should return null if user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const result = await userStore.findUser('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getUserById', () => {
    it('should find user by id', async () => {
      const mockUser = { id: 'user-1', username: 'testuser', passwordHash: 'hash123' };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);

      const result = await userStore.getUserById('user-1');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });
  });

  describe('updateUserPassword', () => {
    it('should update user password', async () => {
      vi.mocked(prisma.user.update).mockResolvedValue({ id: 'user-1', passwordHash: 'newhash' });

      const result = await userStore.updateUserPassword('user-1', 'newhash');

      expect(result).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'newhash' },
      });
    });

    it('should return false if update fails', async () => {
      vi.mocked(prisma.user.update).mockRejectedValue(new Error('User not found'));

      const result = await userStore.updateUserPassword('nonexistent', 'newhash');

      expect(result).toBe(false);
    });
  });
});
