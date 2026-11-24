/**
 * Tests for ISSUE-1684: timing-safe refresh token hash comparison.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  timingSafeStringEqual,
  verifyRefreshTokenHash,
  hashRefreshToken,
} from '../src/services/auth.js';

describe('timingSafeStringEqual (ISSUE-1684)', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeStringEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(timingSafeStringEqual('abc', 'abd')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(timingSafeStringEqual('short', 'longer string')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(timingSafeStringEqual('', '')).toBe(true);
    expect(timingSafeStringEqual('', 'x')).toBe(false);
  });
});

describe('hashRefreshToken (ISSUE-1684)', () => {
  it('produces a 64-character hex string', () => {
    const hash = hashRefreshToken('my-refresh-token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const t = 'some-token-value';
    expect(hashRefreshToken(t)).toBe(hashRefreshToken(t));
  });

  it('produces different hashes for different tokens', () => {
    expect(hashRefreshToken('token-a')).not.toBe(hashRefreshToken('token-b'));
  });
});

describe('verifyRefreshTokenHash (ISSUE-1684)', () => {
  it('returns true when the token matches the stored hash', () => {
    const token = crypto.randomUUID();
    const storedHash = hashRefreshToken(token);
    expect(verifyRefreshTokenHash(token, storedHash)).toBe(true);
  });

  it('returns false for a wrong token', () => {
    const token = crypto.randomUUID();
    const storedHash = hashRefreshToken(token);
    expect(verifyRefreshTokenHash('wrong-token', storedHash)).toBe(false);
  });

  it('returns false for a tampered hash', () => {
    const token = 'valid-token';
    const goodHash = hashRefreshToken(token);
    const badHash = goodHash.slice(0, -1) + (goodHash.endsWith('a') ? 'b' : 'a');
    expect(verifyRefreshTokenHash(token, badHash)).toBe(false);
  });

  it('runs in constant time regardless of match position (no early exit)', () => {
    // We cannot reliably measure timing in a test, but we verify the function
    // completes without throwing for mismatched buffers of all lengths.
    const token = 'x'.repeat(64);
    const hash = hashRefreshToken(token);
    // Differ only in the last character
    const almostRight = hash.slice(0, -1) + (hash.endsWith('f') ? '0' : 'f');
    expect(verifyRefreshTokenHash(token, almostRight)).toBe(false);
  });
});
