/**
 * IP Whitelist persistence and security tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isWhitelisted,
  addToWhitelist,
  removeFromWhitelist,
  getWhitelist,
  clearWhitelist,
  isValidIP,
} from '../src/security/ipWhitelist.js';

vi.mock('../src/db/client.js', () => ({
  default: {
    iPWhitelist: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock('../src/db/adminAuditLog.js', () => ({
  logAdminAction: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/config/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import prisma from '../src/db/client.js';
import { logAdminAction } from '../src/db/adminAuditLog.js';

describe('IP Whitelist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('IP Validation', () => {
    it('should validate IPv4 addresses', () => {
      expect(isValidIP('192.168.1.1')).toBe(true);
      expect(isValidIP('10.0.0.1')).toBe(true);
      expect(isValidIP('255.255.255.255')).toBe(true);
    });

    it('should reject invalid IPv4 addresses', () => {
      expect(isValidIP('256.1.1.1')).toBe(false);
      expect(isValidIP('1.1.1')).toBe(false);
      expect(isValidIP('1.1.1.1.1')).toBe(false);
    });

    it('should validate IPv6 addresses', () => {
      expect(isValidIP('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
      expect(isValidIP('::1')).toBe(true);
      expect(isValidIP('::')).toBe(true);
    });

    it('should validate CIDR notation', () => {
      expect(isValidIP('192.168.1.0/24')).toBe(true);
      expect(isValidIP('10.0.0.0/8')).toBe(true);
      expect(isValidIP('2001:db8::/32')).toBe(true);
    });

    it('should reject invalid CIDR notation', () => {
      expect(isValidIP('192.168.1.0/33')).toBe(false); // IPv4 max is /32
      expect(isValidIP('192.168.1.0/')).toBe(false);
      expect(isValidIP('192.168.1.0/abc')).toBe(false);
    });

    it('should reject null or empty IPs', () => {
      expect(isValidIP(null)).toBe(false);
      expect(isValidIP('')).toBe(false);
      expect(isValidIP(undefined)).toBe(false);
    });
  });

  describe('Whitelist Operations', () => {
    it('should check if IP is whitelisted', () => {
      // Mock the cache with pre-loaded IPs
      vi.mocked(prisma.iPWhitelist.findMany).mockResolvedValueOnce([
        { ipAddress: '192.168.1.1' },
      ]);

      expect(isWhitelisted('192.168.1.1')).toBe(false); // Not loaded yet
    });

    it('should add IP to whitelist with validation', async () => {
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '192.168.1.1',
        reason: 'Test IP',
      });

      const result = await addToWhitelist('192.168.1.1', 'Test IP', 'admin123');

      expect(prisma.iPWhitelist.create).toHaveBeenCalledWith({
        data: {
          ipAddress: '192.168.1.1',
          cidr: null,
          reason: 'Test IP',
          addedBy: 'admin123',
        },
      });

      expect(logAdminAction).toHaveBeenCalledWith(
        'admin123',
        'WHITELIST_IP_ADD',
        'IP_WHITELIST',
        '192.168.1.1',
        { reason: 'Test IP' }
      );
    });

    it('should reject invalid IP addresses', async () => {
      await expect(addToWhitelist('invalid.ip', 'Test', 'admin123')).rejects.toThrow(
        'Invalid IP address or CIDR notation'
      );

      expect(prisma.iPWhitelist.create).not.toHaveBeenCalled();
    });

    it('should add CIDR notation to whitelist', async () => {
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '192.168.1.0/24',
        cidr: '192.168.1.0/24',
      });

      await addToWhitelist('192.168.1.0/24', 'Subnet', 'admin123');

      expect(prisma.iPWhitelist.create).toHaveBeenCalledWith({
        data: {
          ipAddress: '192.168.1.0/24',
          cidr: '192.168.1.0/24',
          reason: 'Subnet',
          addedBy: 'admin123',
        },
      });
    });

    it('should remove IP from whitelist with audit logging', async () => {
      // First add it
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '192.168.1.1',
      });

      await addToWhitelist('192.168.1.1', 'Test', 'admin123');

      // Then remove it
      vi.mocked(prisma.iPWhitelist.delete).mockResolvedValueOnce({});

      await removeFromWhitelist('192.168.1.1', 'admin123');

      expect(prisma.iPWhitelist.delete).toHaveBeenCalledWith({
        where: { ipAddress: '192.168.1.1' },
      });

      expect(logAdminAction).toHaveBeenCalledWith(
        'admin123',
        'WHITELIST_IP_REMOVE',
        'IP_WHITELIST',
        '192.168.1.1',
        {}
      );
    });

    it('should clear entire whitelist with audit logging', async () => {
      vi.mocked(prisma.iPWhitelist.deleteMany).mockResolvedValueOnce({
        count: 2,
      });

      await clearWhitelist('admin123');

      expect(prisma.iPWhitelist.deleteMany).toHaveBeenCalled();
      expect(logAdminAction).toHaveBeenCalledWith(
        'admin123',
        'WHITELIST_CLEAR',
        'IP_WHITELIST',
        'ALL',
        expect.objectContaining({ clearedCount: expect.any(Number) })
      );
    });

    it('should get list of whitelisted IPs', () => {
      const whitelist = getWhitelist();
      expect(Array.isArray(whitelist)).toBe(true);
    });
  });

  describe('Audit Logging', () => {
    it('should log IP additions to audit trail', async () => {
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '10.0.0.1',
      });

      await addToWhitelist('10.0.0.1', 'Office network', 'admin_user_id');

      expect(logAdminAction).toHaveBeenCalledWith(
        'admin_user_id',
        'WHITELIST_IP_ADD',
        'IP_WHITELIST',
        '10.0.0.1',
        { reason: 'Office network' }
      );
    });

    it('should not log audit when no adminId provided', async () => {
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '10.0.0.1',
      });

      await addToWhitelist('10.0.0.1', 'Test', null);

      // Audit logging should be skipped
      expect(logAdminAction).not.toHaveBeenCalled();
    });

    it('should log IP removals to audit trail', async () => {
      vi.mocked(prisma.iPWhitelist.create).mockResolvedValueOnce({
        ipAddress: '10.0.0.1',
      });
      vi.mocked(prisma.iPWhitelist.delete).mockResolvedValueOnce({});

      await addToWhitelist('10.0.0.1', 'Test', 'admin123');
      vi.clearAllMocks(); // Clear the add call

      await removeFromWhitelist('10.0.0.1', 'admin123');

      expect(logAdminAction).toHaveBeenCalledWith(
        'admin123',
        'WHITELIST_IP_REMOVE',
        'IP_WHITELIST',
        '10.0.0.1',
        {}
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle duplicate IP errors gracefully', async () => {
      const error = new Error('Unique constraint failed');
      error.code = 'P2002';
      vi.mocked(prisma.iPWhitelist.create).mockRejectedValueOnce(error);

      await expect(addToWhitelist('192.168.1.1', 'Test', 'admin123')).rejects.toThrow(
        'IP address already whitelisted'
      );
    });

    it('should handle remove non-existent IP errors gracefully', async () => {
      const error = new Error('Record not found');
      error.code = 'P2025';
      vi.mocked(prisma.iPWhitelist.delete).mockRejectedValueOnce(error);

      await expect(removeFromWhitelist('192.168.1.1', 'admin123')).rejects.toThrow(
        'IP address not in whitelist'
      );
    });
  });
});
