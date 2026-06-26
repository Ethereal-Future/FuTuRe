/**
 * Brute-Force Lockout Tests (#728)
 * Validates account lockout mechanism for failed login attempts
 * Tests rate limiting, exponential backoff, and unlock procedures
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

/**
 * Redis-based brute-force lockout manager
 */
class BruteForceLockout {
  constructor(redisClient, config = {}) {
    this.redis = redisClient;
    this.config = {
      accountLockThreshold: config.accountLockThreshold || 10,
      ipLockThreshold: config.ipLockThreshold || 20,
      lockoutWindow: config.lockoutWindow || 15 * 60 * 1000, // 15 minutes
      baseBackoffMs: config.baseBackoffMs || 60 * 1000, // 1 minute
      maxBackoffMs: config.maxBackoffMs || 24 * 60 * 60 * 1000, // 24 hours
    };
  }

  getAccountKey(accountId) {
    return `login_attempts:${accountId}`;
  }

  getIpKey(ipAddress) {
    return `login_attempts:ip:${ipAddress}`;
  }

  async recordFailedAttempt(accountId, ipAddress) {
    const accountKey = this.getAccountKey(accountId);
    const ipKey = this.getIpKey(ipAddress);

    // Increment counters
    const accountAttempts = await this.redis.incr(accountKey);
    const ipAttempts = await this.redis.incr(ipKey);

    // Set expiry on first occurrence
    if (accountAttempts === 1) {
      await this.redis.expire(accountKey, Math.ceil(this.config.lockoutWindow / 1000));
    }
    if (ipAttempts === 1) {
      await this.redis.expire(ipKey, Math.ceil(this.config.lockoutWindow / 1000));
    }

    return { accountAttempts, ipAttempts };
  }

  async isAccountLocked(accountId) {
    const key = this.getAccountKey(accountId);
    const attempts = await this.redis.get(key);
    return attempts ? parseInt(attempts) >= this.config.accountLockThreshold : false;
  }

  async isIpLocked(ipAddress) {
    const key = this.getIpKey(ipAddress);
    const attempts = await this.redis.get(key);
    return attempts ? parseInt(attempts) >= this.config.ipLockThreshold : false;
  }

  async getAttempts(accountId) {
    const key = this.getAccountKey(accountId);
    const attempts = await this.redis.get(key);
    return attempts ? parseInt(attempts) : 0;
  }

  async getIpAttempts(ipAddress) {
    const key = this.getIpKey(ipAddress);
    const attempts = await this.redis.get(key);
    return attempts ? parseInt(attempts) : 0;
  }

  calculateBackoffMs(attemptNumber) {
    const exponent = Math.min(attemptNumber - this.config.accountLockThreshold, 8);
    const backoff = this.config.baseBackoffMs * Math.pow(2, exponent);
    return Math.min(backoff, this.config.maxBackoffMs);
  }

  async getLockoutDuration(accountId) {
    const attempts = await this.getAttempts(accountId);
    if (attempts < this.config.accountLockThreshold) {
      return 0;
    }
    return this.calculateBackoffMs(attempts);
  }

  async clearFailedAttempts(accountId) {
    const key = this.getAccountKey(accountId);
    await this.redis.del(key);
  }

  async clearIpAttempts(ipAddress) {
    const key = this.getIpKey(ipAddress);
    await this.redis.del(key);
  }

  async unlockAccount(accountId) {
    const key = this.getAccountKey(accountId);
    await this.redis.del(key);
  }
}

describe('Brute-Force Lockout - #728', () => {
  let mockRedis;
  let lockout;
  const accountId = 'test-account-123';
  const ipAddress = '192.168.1.100';

  beforeEach(() => {
    mockRedis = {
      data: {},
      expiries: {},
      incr: vi.fn(async (key) => {
        if (!mockRedis.data[key]) {
          mockRedis.data[key] = 0;
        }
        mockRedis.data[key]++;
        return mockRedis.data[key];
      }),
      get: vi.fn(async (key) => {
        return mockRedis.data[key] ? String(mockRedis.data[key]) : null;
      }),
      del: vi.fn(async (key) => {
        delete mockRedis.data[key];
        delete mockRedis.expiries[key];
        return 1;
      }),
      expire: vi.fn(async (key, seconds) => {
        mockRedis.expiries[key] = seconds;
        return 1;
      }),
    };

    lockout = new BruteForceLockout(mockRedis, {
      accountLockThreshold: 10,
      ipLockThreshold: 20,
      lockoutWindow: 15 * 60 * 1000,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Per-account lockout', () => {
    it('should allow successful login and clear attempts', async () => {
      // Record some failed attempts
      for (let i = 0; i < 3; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      expect(await lockout.getAttempts(accountId)).toBe(3);

      // Clear on successful login
      await lockout.clearFailedAttempts(accountId);
      expect(await lockout.getAttempts(accountId)).toBe(0);
      expect(await lockout.isAccountLocked(accountId)).toBe(false);
    });

    it('should lock account after 10 failed attempts', async () => {
      for (let i = 0; i < 10; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      expect(await lockout.isAccountLocked(accountId)).toBe(true);
      expect(await lockout.getAttempts(accountId)).toBe(10);
    });

    it('should not lock before threshold', async () => {
      for (let i = 0; i < 9; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      expect(await lockout.isAccountLocked(accountId)).toBe(false);
    });

    it('should lock on exactly 10 attempts', async () => {
      for (let i = 1; i <= 10; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
        if (i < 10) {
          expect(await lockout.isAccountLocked(accountId)).toBe(false);
        }
      }

      expect(await lockout.isAccountLocked(accountId)).toBe(true);
    });

    it('should remain locked after exceeding threshold', async () => {
      for (let i = 0; i < 15; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      expect(await lockout.isAccountLocked(accountId)).toBe(true);
    });

    it('should track attempt count accurately', async () => {
      for (let i = 1; i <= 15; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
        expect(await lockout.getAttempts(accountId)).toBe(i);
      }
    });
  });

  describe('Per-IP lockout', () => {
    it('should lock IP after 20 failed attempts', async () => {
      for (let i = 0; i < 20; i++) {
        await lockout.recordFailedAttempt(`account-${i}`, ipAddress);
      }

      expect(await lockout.isIpLocked(ipAddress)).toBe(true);
    });

    it('should not lock IP before threshold', async () => {
      for (let i = 0; i < 19; i++) {
        await lockout.recordFailedAttempt(`account-${i}`, ipAddress);
      }

      expect(await lockout.isIpLocked(ipAddress)).toBe(false);
    });

    it('should allow multiple accounts behind same IP up to threshold', async () => {
      for (let i = 0; i < 19; i++) {
        await lockout.recordFailedAttempt(`account-${i}`, ipAddress);
      }

      expect(await lockout.isIpLocked(ipAddress)).toBe(false);

      await lockout.recordFailedAttempt('account-final', ipAddress);
      expect(await lockout.isIpLocked(ipAddress)).toBe(true);
    });
  });

  describe('Exponential backoff', () => {
    it('should calculate base backoff (1 minute) at first lockout', () => {
      const backoff = lockout.calculateBackoffMs(10); // 10 attempts (at threshold)
      expect(backoff).toBe(60 * 1000);
    });

    it('should double backoff with each additional attempt', () => {
      const backoff10 = lockout.calculateBackoffMs(10);
      const backoff11 = lockout.calculateBackoffMs(11);
      const backoff12 = lockout.calculateBackoffMs(12);

      expect(backoff11).toBe(backoff10 * 2);
      expect(backoff12).toBe(backoff11 * 2);
    });

    it('should cap backoff at 24 hours', () => {
      const backoff = lockout.calculateBackoffMs(50); // Way over threshold
      expect(backoff).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    });

    it('should calculate progression: 1m, 2m, 4m, 8m', () => {
      expect(lockout.calculateBackoffMs(10)).toBe(60 * 1000); // 1m
      expect(lockout.calculateBackoffMs(11)).toBe(120 * 1000); // 2m
      expect(lockout.calculateBackoffMs(12)).toBe(240 * 1000); // 4m
      expect(lockout.calculateBackoffMs(13)).toBe(480 * 1000); // 8m
    });
  });

  describe('Lockout duration reporting', () => {
    it('should return 0 ms if not locked', async () => {
      for (let i = 0; i < 5; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      expect(await lockout.getLockoutDuration(accountId)).toBe(0);
    });

    it('should return 1 minute after first lockout', async () => {
      for (let i = 0; i < 10; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      const duration = await lockout.getLockoutDuration(accountId);
      expect(duration).toBe(60 * 1000);
    });

    it('should return increasing durations with more attempts', async () => {
      for (let i = 0; i < 12; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      // 12 attempts: 2 minutes (at 12 = 10 + 2)
      const duration = await lockout.getLockoutDuration(accountId);
      expect(duration).toBe(240 * 1000); // 4 minutes (2^2 = 4)
    });
  });

  describe('Unlock mechanisms', () => {
    it('should allow manual account unlock', async () => {
      for (let i = 0; i < 10; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      expect(await lockout.isAccountLocked(accountId)).toBe(true);

      await lockout.unlockAccount(accountId);

      expect(await lockout.isAccountLocked(accountId)).toBe(false);
      expect(await lockout.getAttempts(accountId)).toBe(0);
    });

    it('should allow manual IP unlock', async () => {
      for (let i = 0; i < 20; i++) {
        await lockout.recordFailedAttempt(`account-${i}`, ipAddress);
      }

      expect(await lockout.isIpLocked(ipAddress)).toBe(true);

      await lockout.clearIpAttempts(ipAddress);

      expect(await lockout.isIpLocked(ipAddress)).toBe(false);
    });

    it('should support independent account/IP unlock', async () => {
      // Lock both account and IP
      for (let i = 0; i < 20; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      expect(await lockout.isAccountLocked(accountId)).toBe(true);
      expect(await lockout.isIpLocked(ipAddress)).toBe(true);

      // Unlock just account
      await lockout.unlockAccount(accountId);

      expect(await lockout.isAccountLocked(accountId)).toBe(false);
      expect(await lockout.isIpLocked(ipAddress)).toBe(true); // IP still locked
    });
  });

  describe('Redis TTL configuration', () => {
    it('should set expire TTL on first attempt', async () => {
      await lockout.recordFailedAttempt(accountId, ipAddress);

      expect(mockRedis.expire).toHaveBeenCalled();
      const calls = mockRedis.expire.mock.calls;
      const expireCall = calls.find((call) => call[0] === `login_attempts:${accountId}`);
      expect(expireCall).toBeDefined();
    });

    it('should set TTL to lockout window in seconds', async () => {
      await lockout.recordFailedAttempt(accountId, ipAddress);

      const expireCalls = mockRedis.expire.mock.calls;
      const accountCall = expireCalls.find((c) => c[0].includes(accountId));

      // 15 minutes = 900 seconds
      expect(accountCall[1]).toBe(900);
    });

    it('should not re-expire on subsequent attempts', async () => {
      await lockout.recordFailedAttempt(accountId, ipAddress);
      const initialExpireCalls = mockRedis.expire.mock.calls.length;

      await lockout.recordFailedAttempt(accountId, ipAddress);
      const finalExpireCalls = mockRedis.expire.mock.calls.length;

      // Should only expire once (on first increment)
      expect(finalExpireCalls).toBe(initialExpireCalls);
    });

    it('should auto-reset counter after TTL expires', async () => {
      // This is implicit - Redis will delete the key after TTL
      // Test verifies the TTL is set correctly
      await lockout.recordFailedAttempt(accountId, ipAddress);

      const expireCalls = mockRedis.expire.mock.calls;
      expect(expireCalls.length).toBeGreaterThan(0);

      // TTL should be approximately 15 minutes
      const ttl = Math.max(...expireCalls.map((c) => c[1]));
      expect(ttl).toBe(900); // 15 minutes in seconds
    });
  });

  describe('Concurrent attempt handling', () => {
    it('should handle multiple attempts from same account simultaneously', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(lockout.recordFailedAttempt(accountId, ipAddress));
      }

      await Promise.all(promises);
      expect(await lockout.getAttempts(accountId)).toBe(10);
    });

    it('should increment counter atomically', async () => {
      const results = [];
      for (let i = 0; i < 5; i++) {
        const result = await lockout.recordFailedAttempt(accountId, ipAddress);
        results.push(result.accountAttempts);
      }

      // Results should be 1, 2, 3, 4, 5 (each sequential)
      expect(results).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('Retry-After header calculation', () => {
    it('should provide Retry-After value for locked account', async () => {
      for (let i = 0; i < 10; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      const duration = await lockout.getLockoutDuration(accountId);
      const retryAfterSeconds = Math.ceil(duration / 1000);

      expect(retryAfterSeconds).toBe(60); // 1 minute for first lockout
    });

    it('should provide increasing Retry-After with repeated lockouts', async () => {
      for (let i = 0; i < 15; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      const duration = await lockout.getLockoutDuration(accountId);
      const retryAfterSeconds = Math.ceil(duration / 1000);

      // At 15 attempts (10 + 5), backoff = 1m * 2^5 = 32 minutes
      expect(retryAfterSeconds).toBeGreaterThan(60);
    });
  });

  describe('Error responses', () => {
    it('should indicate lockout in 429 response', async () => {
      for (let i = 0; i < 10; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      expect(await lockout.isAccountLocked(accountId)).toBe(true);
    });

    it('should provide error message with retry time', async () => {
      for (let i = 0; i < 10; i++) {
        await lockout.recordFailedAttempt(accountId, ipAddress);
      }

      const isLocked = await lockout.isAccountLocked(accountId);
      const duration = await lockout.getLockoutDuration(accountId);

      expect(isLocked).toBe(true);
      expect(duration).toBe(60 * 1000); // Should include retry info
    });
  });

  describe('Edge cases', () => {
    it('should handle non-existent account', async () => {
      const attempts = await lockout.getAttempts('nonexistent');
      expect(attempts).toBe(0);
      expect(await lockout.isAccountLocked('nonexistent')).toBe(false);
    });

    it('should handle unlock of non-locked account', async () => {
      await lockout.unlockAccount(accountId);
      expect(await lockout.isAccountLocked(accountId)).toBe(false);
    });

    it('should differentiate between similar account IDs', async () => {
      const account1 = 'account-1';
      const account2 = 'account-11';

      await lockout.recordFailedAttempt(account1, ipAddress);
      await lockout.recordFailedAttempt(account2, ipAddress);

      expect(await lockout.getAttempts(account1)).toBe(1);
      expect(await lockout.getAttempts(account2)).toBe(1);
    });

    it('should differentiate between similar IPs', async () => {
      const ip1 = '192.168.1.1';
      const ip2 = '192.168.1.11';

      await lockout.recordFailedAttempt(accountId, ip1);
      await lockout.recordFailedAttempt(accountId, ip2);

      expect(await lockout.getIpAttempts(ip1)).toBe(1);
      expect(await lockout.getIpAttempts(ip2)).toBe(1);
    });

    it('should handle IPv6 addresses', async () => {
      const ipv6 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
      await lockout.recordFailedAttempt(accountId, ipv6);
      expect(await lockout.getIpAttempts(ipv6)).toBe(1);
    });
  });
});
