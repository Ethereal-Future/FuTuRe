import { describe, it, expect } from 'vitest';
import mfaManager from '../src/security/mfa.js';

describe('MFA Manager', () => {
  const userId = 'test-user-123';
  const encryptionKey = '0'.repeat(64); // 32 bytes in hex

  it('should generate a secret with QR code', () => {
    const { secret, qrCode } = mfaManager.generateSecret(userId);
    expect(secret).toBeDefined();
    expect(qrCode).toBeDefined();
    expect(qrCode).toContain('otpauth://');
  });

  it('should enable MFA and return backup codes', () => {
    const { secret } = mfaManager.generateSecret(userId);
    const backupCodes = mfaManager.enableMFA(userId, secret);
    
    expect(backupCodes).toHaveLength(10);
    expect(backupCodes[0]).toBeDefined();
    expect(typeof backupCodes[0]).toBe('string');
  });

  it('should encrypt and decrypt secrets', () => {
    const secret = 'JBSWY3DPEBLW64TMMQ======';
    const encrypted = mfaManager.encryptSecret(secret, encryptionKey);
    
    expect(encrypted).not.toBe(secret);
    expect(encrypted).toContain(':');
    
    const decrypted = mfaManager.decryptSecret(encrypted, encryptionKey);
    expect(decrypted).toBe(secret);
  });

  it('should verify valid TOTP token', () => {
    const { secret } = mfaManager.generateSecret(userId);
    
    // Generate a valid TOTP token using speakeasy
    const speakeasy = await import('speakeasy');
    const token = speakeasy.totp({
      secret,
      encoding: 'base32'
    });
    
    expect(() => {
      mfaManager.verifyTOTP(userId, token, secret);
    }).not.toThrow();
  });

  it('should reject invalid TOTP token', () => {
    const { secret } = mfaManager.generateSecret(userId);
    
    expect(() => {
      mfaManager.verifyTOTP(userId, '000000', secret);
    }).toThrow('Invalid TOTP token');
  });

  it('should verify backup codes', () => {
    const { secret } = mfaManager.generateSecret(userId);
    const backupCodes = mfaManager.enableMFA(userId, secret);
    const firstCode = backupCodes[0];
    
    expect(() => {
      mfaManager.verifyBackupCode(userId, firstCode);
    }).not.toThrow();
  });

  it('should reject invalid backup code', () => {
    const { secret } = mfaManager.generateSecret(userId);
    mfaManager.enableMFA(userId, secret);
    
    expect(() => {
      mfaManager.verifyBackupCode(userId, 'invalid-code');
    }).toThrow('Invalid backup code');
  });

  it('should disable MFA', () => {
    const { secret } = mfaManager.generateSecret(userId);
    mfaManager.enableMFA(userId, secret);
    
    expect(mfaManager.isMFAEnabled(userId)).toBe(true);
    
    mfaManager.disableMFA(userId);
    expect(mfaManager.isMFAEnabled(userId)).toBe(false);
  });

  it('should check if MFA is enabled', () => {
    const { secret } = mfaManager.generateSecret(userId);
    
    expect(mfaManager.isMFAEnabled(userId)).toBe(false);
    
    mfaManager.enableMFA(userId, secret);
    expect(mfaManager.isMFAEnabled(userId)).toBe(true);
  });
});
