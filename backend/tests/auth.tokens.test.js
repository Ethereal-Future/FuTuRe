import { describe, it, expect, beforeEach } from 'vitest';
import { signAccessToken, verifyToken, signRefreshToken } from '../src/auth/tokens.js';
import { resetConfig } from '../src/config/env.js';

describe('JWT Tokens', () => {
  beforeEach(() => {
    resetConfig();
    process.env.JWT_SECRET = 'test-secret-key-12345';
  });

  it('should sign and verify access token', () => {
    const payload = { userId: 'user-123', role: 'admin' };
    const token = signAccessToken(payload);
    expect(token).toBeDefined();
    
    const verified = verifyToken(token);
    expect(verified.userId).toBe('user-123');
    expect(verified.role).toBe('admin');
  });

  it('should sign and verify refresh token', () => {
    const payload = { userId: 'user-456' };
    const token = signRefreshToken(payload);
    expect(token).toBeDefined();
    
    const verified = verifyToken(token);
    expect(verified.userId).toBe('user-456');
  });

  it('should use JWT_SECRET from config', () => {
    const payload = { userId: 'test-user' };
    const token = signAccessToken(payload);
    const verified = verifyToken(token);
    expect(verified.userId).toBe('test-user');
  });

  it('should throw error when JWT_SECRET is not configured', () => {
    resetConfig();
    delete process.env.JWT_SECRET;
    
    expect(() => {
      signAccessToken({ userId: 'user' });
    }).toThrow('JWT_SECRET is not configured');
  });
});
