import { describe, it, expect, beforeEach } from 'vitest';
import { generateCSRFToken, validateCSRFToken } from '../src/middleware/csrf.js';

describe('CSRF Protection', () => {
  beforeEach(() => {
    // Clear tokens before each test
    // Note: In a real test, you'd need to reset the in-memory store
  });

  it('should generate a valid CSRF token', () => {
    const token = generateCSRFToken();
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.length).toBe(64); // 32 bytes in hex = 64 chars
  });

  it('should validate a generated token', () => {
    const token = generateCSRFToken();
    expect(validateCSRFToken(token)).toBe(true);
  });

  it('should reject an invalid token', () => {
    expect(validateCSRFToken('invalid-token')).toBe(false);
  });

  it('should reject a null token', () => {
    expect(validateCSRFToken(null)).toBe(false);
  });

  it('should reject an undefined token', () => {
    expect(validateCSRFToken(undefined)).toBe(false);
  });

  it('should reject an empty string token', () => {
    expect(validateCSRFToken('')).toBe(false);
  });

  it('should generate unique tokens', () => {
    const token1 = generateCSRFToken();
    const token2 = generateCSRFToken();
    expect(token1).not.toBe(token2);
  });

  it('should validate multiple tokens independently', () => {
    const token1 = generateCSRFToken();
    const token2 = generateCSRFToken();
    
    expect(validateCSRFToken(token1)).toBe(true);
    expect(validateCSRFToken(token2)).toBe(true);
  });
});
