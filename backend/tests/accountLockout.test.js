import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordFailedLogin, isAccountLocked, unlockAccount, clearFailedAttempts } from '../src/security/accountLockout.js';

describe('Account Lockout', () => {
  const testUsername = 'testuser';
  const testIP = '192.168.1.1';

  beforeEach(async () => {
    // Clear any existing lockouts
    await unlockAccount(testUsername);
  });

  it('should lock account after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await recordFailedLogin(testUsername, testIP);
      if (i < 4) {
        expect(result.locked).toBe(false);
      } else {
        expect(result.locked).toBe(true);
      }
    }

    const locked = await isAccountLocked(testUsername);
    expect(locked).toBe(true);
  });

  it('should return 423 status when account is locked', async () => {
    // Lock the account
    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(testUsername, testIP);
    }

    const locked = await isAccountLocked(testUsername);
    expect(locked).toBe(true);
  });

  it('should allow manual unlock', async () => {
    // Lock the account
    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(testUsername, testIP);
    }

    expect(await isAccountLocked(testUsername)).toBe(true);

    // Unlock
    await unlockAccount(testUsername);
    expect(await isAccountLocked(testUsername)).toBe(false);
  });

  it('should clear failed attempts on successful login', async () => {
    // Record some failed attempts
    await recordFailedLogin(testUsername, testIP);
    await recordFailedLogin(testUsername, testIP);

    // Clear attempts
    await clearFailedAttempts(testUsername);

    // Should not be locked
    const locked = await isAccountLocked(testUsername);
    expect(locked).toBe(false);
  });

  it('should track attempts per username', async () => {
    const user1 = 'user1';
    const user2 = 'user2';

    // Lock user1
    for (let i = 0; i < 5; i++) {
      await recordFailedLogin(user1, testIP);
    }

    // user2 should not be locked
    expect(await isAccountLocked(user1)).toBe(true);
    expect(await isAccountLocked(user2)).toBe(false);
  });
});
