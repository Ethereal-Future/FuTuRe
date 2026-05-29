import { describe, it, expect } from 'vitest';
import { sanitizeLogData } from '../src/utils/sanitizeLogData.js';

describe('sanitizeLogData', () => {
  it('should redact secretKey field', () => {
    const data = { secretKey: 'SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' };
    const result = sanitizeLogData(data);
    expect(result.secretKey).toBe('[REDACTED]');
  });

  it('should redact senderSecret field', () => {
    const data = { senderSecret: 'SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' };
    const result = sanitizeLogData(data);
    expect(result.senderSecret).toBe('[REDACTED]');
  });

  it('should redact password field', () => {
    const data = { password: 'myPassword123' };
    const result = sanitizeLogData(data);
    expect(result.password).toBe('[REDACTED]');
  });

  it('should redact token field', () => {
    const data = { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' };
    const result = sanitizeLogData(data);
    expect(result.token).toBe('[REDACTED]');
  });

  it('should redact nested sensitive fields', () => {
    const data = {
      user: {
        id: '123',
        secretKey: 'SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        profile: {
          password: 'secret'
        }
      }
    };
    const result = sanitizeLogData(data);
    expect(result.user.secretKey).toBe('[REDACTED]');
    expect(result.user.profile.password).toBe('[REDACTED]');
    expect(result.user.id).toBe('123');
  });

  it('should handle arrays with sensitive data', () => {
    const data = {
      keys: [
        { secretKey: 'SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' },
        { secretKey: 'SBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' }
      ]
    };
    const result = sanitizeLogData(data);
    expect(result.keys[0].secretKey).toBe('[REDACTED]');
    expect(result.keys[1].secretKey).toBe('[REDACTED]');
  });

  it('should preserve non-sensitive data', () => {
    const data = {
      id: '123',
      username: 'john',
      email: 'john@example.com',
      amount: 100
    };
    const result = sanitizeLogData(data);
    expect(result).toEqual(data);
  });

  it('should handle null and undefined', () => {
    expect(sanitizeLogData(null)).toBe(null);
    expect(sanitizeLogData(undefined)).toBe(undefined);
  });

  it('should handle primitives', () => {
    expect(sanitizeLogData('string')).toBe('string');
    expect(sanitizeLogData(123)).toBe(123);
    expect(sanitizeLogData(true)).toBe(true);
  });

  it('should be case-insensitive for sensitive keys', () => {
    const data = {
      SECRET: 'value',
      Secret: 'value',
      SECRET_KEY: 'value',
      PrivateKey: 'value',
      PASSWORD: 'value'
    };
    const result = sanitizeLogData(data);
    expect(result.SECRET).toBe('[REDACTED]');
    expect(result.Secret).toBe('[REDACTED]');
    expect(result.SECRET_KEY).toBe('[REDACTED]');
    expect(result.PrivateKey).toBe('[REDACTED]');
    expect(result.PASSWORD).toBe('[REDACTED]');
  });
});
