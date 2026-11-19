import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mfaManager from '../src/security/mfa.js';
import logger from '../src/utils/logger.js';

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

  describe('decryption failure propagation', () => {
    const originalKey = process.env.CONFIG_ENCRYPTION_KEY;
    const keyA = 'a'.repeat(64); // 32 bytes in hex
    const keyB = 'b'.repeat(64); // different 32-byte key

    beforeEach(() => {
      process.env.CONFIG_ENCRYPTION_KEY = keyA;
    });

    afterEach(() => {
      if (originalKey === undefined) {
        delete process.env.CONFIG_ENCRYPTION_KEY;
      } else {
        process.env.CONFIG_ENCRYPTION_KEY = originalKey;
      }
      vi.restoreAllMocks();
    });

    it('should throw a CryptographicError when the encryption key does not match', () => {
      const secret = 'JBSWY3DPEBLW64TMMQ======';
      const encrypted = mfaManager.encryptField(secret);

      // Rotate the key so decryption can no longer succeed.
      process.env.CONFIG_ENCRYPTION_KEY = keyB;

      expect(() => mfaManager.decryptField(encrypted)).toThrow(
        /CryptographicError|DecryptionError/
      );
    });

    it('should throw a CryptographicError when the ciphertext is corrupted', () => {
      const secret = 'JBSWY3DPEBLW64TMMQ======';
      const encrypted = mfaManager.encryptField(secret);
      const corrupted = `${encrypted.slice(0, -4)}dead`;

      expect(() => mfaManager.decryptField(corrupted)).toThrow(
        /CryptographicError|DecryptionError/
      );
    });

    it('should never return the raw ciphertext on decryption failure', () => {
      const secret = 'JBSWY3DPEBLW64TMMQ======';
      const encrypted = mfaManager.encryptField(secret);

      process.env.CONFIG_ENCRYPTION_KEY = keyB;

      let result;
      try {
        result = mfaManager.decryptField(encrypted);
      } catch (err) {
        result = undefined;
      }

      expect(result).not.toBe(encrypted);
    });

    it('should throw from verifyTOTP when the stored secret cannot be decrypted', () => {
      const { secret } = mfaManager.generateSecret(userId);
      mfaManager.enableMFA(userId, secret);

      // Rotate the key so the stored secret can no longer be decrypted.
      process.env.CONFIG_ENCRYPTION_KEY = keyB;

      expect(() => mfaManager.verifyTOTP(userId, '123456')).toThrow(
        /CryptographicError|DecryptionError/
      );
    });

    it('should log a critical alert when decryption fails', () => {
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const secret = 'JBSWY3DPEBLW64TMMQ======';
      const encrypted = mfaManager.encryptField(secret);

      process.env.CONFIG_ENCRYPTION_KEY = keyB;

      expect(() => mfaManager.decryptField(encrypted)).toThrow();

      expect(errorSpy).toHaveBeenCalled();
      const loggedCritical = errorSpy.mock.calls.some((call) =>
        JSON.stringify(call).toLowerCase().includes('critical')
      );
      expect(loggedCritical).toBe(true);
    });
  });
});
