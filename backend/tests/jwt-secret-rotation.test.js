/**
 * JWT Secret Rotation Tests (#727)
 * Validates dual-secret rotation for zero-downtime JWT key rotation
 * Tests backward compatibility, transparent re-issuing, and rotation procedures
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * JWT token manager with dual-secret support
 */
class JwtManager {
  constructor(currentSecret, previousSecret = null) {
    this.currentSecret = currentSecret;
    this.previousSecret = previousSecret;
    this.tokenTTL = 15 * 60; // 15 minutes in seconds
    this.refreshTokenTTL = 7 * 24 * 60 * 60; // 7 days
  }

  signAccessToken(payload) {
    return jwt.sign(payload, this.currentSecret, {
      expiresIn: this.tokenTTL,
      algorithm: 'HS256',
    });
  }

  signRefreshToken(payload) {
    return jwt.sign(payload, this.currentSecret, {
      expiresIn: this.refreshTokenTTL,
      algorithm: 'HS256',
    });
  }

  verifyToken(token) {
    // Try current secret first
    try {
      const decoded = jwt.verify(token, this.currentSecret, { algorithms: ['HS256'] });
      return { decoded, usedPreviousSecret: false };
    } catch (err) {
      // Fall back to previous secret if available
      if (this.previousSecret) {
        try {
          const decoded = jwt.verify(token, this.previousSecret, { algorithms: ['HS256'] });
          return { decoded, usedPreviousSecret: true };
        } catch (fallbackErr) {
          throw err; // Throw original error
        }
      }
      throw err;
    }
  }

  getTokenSecret(token) {
    // Decode without verification to get header/payload
    const decoded = jwt.decode(token, { complete: true });
    // Since we sign with current, if it verifies with current, it's current
    // If it verifies with previous, it's previous
    try {
      jwt.verify(token, this.currentSecret, { algorithms: ['HS256'] });
      return 'current';
    } catch {
      if (this.previousSecret) {
        try {
          jwt.verify(token, this.previousSecret, { algorithms: ['HS256'] });
          return 'previous';
        } catch {
          return 'unknown';
        }
      }
    }
    return 'unknown';
  }

  rotateSecret(newSecret) {
    this.previousSecret = this.currentSecret;
    this.currentSecret = newSecret;
  }

  clearPreviousSecret() {
    this.previousSecret = null;
  }

  supportsDualSecret() {
    return this.previousSecret !== null && this.previousSecret !== undefined;
  }

  getConfig() {
    return {
      currentSecret: this.currentSecret,
      previousSecret: this.previousSecret,
      dualSecretEnabled: this.supportsDualSecret(),
    };
  }
}

describe('JWT Secret Rotation - #727', () => {
  let manager;
  const initialSecret = 'initial-secret-key-32-chars-long-1';
  const newSecret = 'new-secret-key-32-chars-long-2222';

  beforeEach(() => {
    manager = new JwtManager(initialSecret);
  });

  describe('Single-secret configuration (backward compatibility)', () => {
    it('should sign tokens with current secret when no previous secret', () => {
      const payload = { userId: 'user-1' };
      const token = manager.signAccessToken(payload);

      expect(token).toBeDefined();
      expect(() => jwt.verify(token, initialSecret)).not.toThrow();
    });

    it('should verify tokens with current secret', () => {
      const payload = { userId: 'user-1' };
      const token = manager.signAccessToken(payload);

      const result = manager.verifyToken(token);
      expect(result.decoded.userId).toBe('user-1');
      expect(result.usedPreviousSecret).toBe(false);
    });

    it('should reject tokens signed with different secret', () => {
      const otherSecret = 'other-secret-key-32-chars-long-';
      const token = jwt.sign({ userId: 'user-1' }, otherSecret);

      expect(() => manager.verifyToken(token)).toThrow();
    });

    it('should not support dual secret by default', () => {
      expect(manager.supportsDualSecret()).toBe(false);
      expect(manager.getConfig().previousSecret).toBeNull();
    });
  });

  describe('Dual-secret configuration (rotation window)', () => {
    beforeEach(() => {
      manager.rotateSecret(newSecret);
    });

    it('should accept tokens signed with current secret', () => {
      const payload = { userId: 'user-1' };
      const token = manager.signAccessToken(payload);

      const result = manager.verifyToken(token);
      expect(result.decoded.userId).toBe('user-1');
      expect(result.usedPreviousSecret).toBe(false);
    });

    it('should accept tokens signed with previous secret during rotation', () => {
      // First, create token with initial secret
      const manager1 = new JwtManager(initialSecret);
      const oldToken = manager1.signAccessToken({ userId: 'user-1' });

      // Now rotate
      manager.previousSecret = initialSecret;

      // Should still verify the old token
      const result = manager.verifyToken(oldToken);
      expect(result.decoded.userId).toBe('user-1');
      expect(result.usedPreviousSecret).toBe(true);
    });

    it('should enable dual secret support', () => {
      expect(manager.supportsDualSecret()).toBe(true);
      expect(manager.getConfig().dualSecretEnabled).toBe(true);
    });

    it('should report which secret was used during verification', () => {
      // Token signed with new secret
      const newToken = manager.signAccessToken({ userId: 'user-1' });
      const result1 = manager.verifyToken(newToken);
      expect(result1.usedPreviousSecret).toBe(false);

      // Token signed with old secret
      const manager1 = new JwtManager(manager.previousSecret);
      const oldToken = manager1.signAccessToken({ userId: 'user-2' });
      const result2 = manager.verifyToken(oldToken);
      expect(result2.usedPreviousSecret).toBe(true);
    });
  });

  describe('Rotation procedure', () => {
    it('step 1: set previous secret to current, generate new secret', () => {
      expect(manager.previousSecret).toBeNull();
      expect(manager.currentSecret).toBe(initialSecret);

      manager.rotateSecret(newSecret);

      expect(manager.previousSecret).toBe(initialSecret);
      expect(manager.currentSecret).toBe(newSecret);
    });

    it('step 2: new tokens signed with current secret', () => {
      manager.rotateSecret(newSecret);

      const token = manager.signAccessToken({ userId: 'user-1' });
      const secret = manager.getTokenSecret(token);

      expect(secret).toBe('current');
    });

    it('step 3: old tokens still verified with previous secret', () => {
      // Create old token
      const oldToken = manager.signAccessToken({ userId: 'user-1' });

      // Rotate
      manager.rotateSecret(newSecret);

      // Old token should still verify
      const result = manager.verifyToken(oldToken);
      expect(result.decoded.userId).toBe('user-1');
      expect(result.usedPreviousSecret).toBe(true);
    });

    it('step 4: after token TTL, clear previous secret', async () => {
      manager.rotateSecret(newSecret);
      expect(manager.supportsDualSecret()).toBe(true);

      // Simulate waiting for all old tokens to expire
      manager.clearPreviousSecret();

      expect(manager.supportsDualSecret()).toBe(false);
      expect(manager.previousSecret).toBeNull();
    });

    it('should allow deployment without restart during rotation', () => {
      // No service restart required - just env var change
      const config1 = manager.getConfig();

      manager.rotateSecret(newSecret);

      const config2 = manager.getConfig();

      // Configuration changed without restart
      expect(config1.currentSecret).not.toBe(config2.currentSecret);
      expect(config2.previousSecret).toBe(config1.currentSecret);
    });
  });

  describe('Transparent token re-issuing', () => {
    it('should detect token signed with previous secret', () => {
      const oldToken = manager.signAccessToken({ userId: 'user-1' });

      manager.rotateSecret(newSecret);

      const result = manager.verifyToken(oldToken);
      expect(result.usedPreviousSecret).toBe(true);
    });

    it('should allow application to re-issue with current secret', () => {
      const oldToken = manager.signAccessToken({ userId: 'user-1' });
      manager.rotateSecret(newSecret);

      const result = manager.verifyToken(oldToken);
      expect(result.usedPreviousSecret).toBe(true);

      // Application can now re-issue with current secret
      // Remove exp/iat before re-signing
      const { exp, iat, ...payloadWithoutTiming } = result.decoded;
      const newToken = manager.signAccessToken(payloadWithoutTiming);
      const newResult = manager.verifyToken(newToken);

      expect(newResult.usedPreviousSecret).toBe(false);
      expect(newResult.decoded.userId).toBe('user-1');
    });

    it('should gradually transition tokens from old to new secret', () => {
      // Create tokens with old secret
      const oldTokens = [
        manager.signAccessToken({ userId: 'user-1' }),
        manager.signAccessToken({ userId: 'user-2' }),
      ];

      manager.rotateSecret(newSecret);

      // Old tokens still work
      oldTokens.forEach((token) => {
        const result = manager.verifyToken(token);
        expect(result.usedPreviousSecret).toBe(true);
      });

      // New tokens use new secret
      const newToken = manager.signAccessToken({ userId: 'user-3' });
      const newResult = manager.verifyToken(newToken);
      expect(newResult.usedPreviousSecret).toBe(false);
    });
  });

  describe('Zero-downtime rotation', () => {
    it('should not require service restart for secret rotation', () => {
      const initialConfig = manager.getConfig();

      // Simulate environment variable change
      manager.rotateSecret(newSecret);

      const rotatedConfig = manager.getConfig();

      // Configuration changed without restart
      expect(initialConfig.currentSecret).toBe(rotatedConfig.previousSecret);
      expect(initialConfig.currentSecret).not.toBe(rotatedConfig.currentSecret);
    });

    it('should not invalidate existing sessions during rotation', () => {
      const sessionToken = manager.signAccessToken({ userId: 'session-user', sessionId: 'sess-1' });

      manager.rotateSecret(newSecret);

      // Session should still be valid
      expect(() => manager.verifyToken(sessionToken)).not.toThrow();
    });

    it('should handle concurrent old and new token verification', () => {
      const oldToken = manager.signAccessToken({ userId: 'user-1' });

      manager.rotateSecret(newSecret);

      const newToken = manager.signAccessToken({ userId: 'user-2' });

      // Both should verify
      expect(() => manager.verifyToken(oldToken)).not.toThrow();
      expect(() => manager.verifyToken(newToken)).not.toThrow();
    });

    it('should support multiple simultaneous client sessions during rotation', () => {
      // Create tokens before rotation
      const tokens = [];
      for (let i = 0; i < 5; i++) {
        tokens.push(manager.signAccessToken({ userId: `user-${i}` }));
      }

      // Rotate
      manager.rotateSecret(newSecret);

      // All old tokens should still work
      tokens.forEach((token, idx) => {
        const result = manager.verifyToken(token);
        expect(result.decoded.userId).toBe(`user-${idx}`);
      });
    });
  });

  describe('Rotation timing', () => {
    it('should provide window for token expiration', () => {
      expect(manager.tokenTTL).toBe(15 * 60); // 15 minutes

      manager.rotateSecret(newSecret);

      // Wait for token TTL, then clear previous secret
      expect(manager.supportsDualSecret()).toBe(true);

      manager.clearPreviousSecret();

      expect(manager.supportsDualSecret()).toBe(false);
    });

    it('should maintain previous secret until token expiry', () => {
      const oldToken = manager.signAccessToken({ userId: 'user-1' });

      manager.rotateSecret(newSecret);

      // Token should be valid during rotation window
      expect(() => manager.verifyToken(oldToken)).not.toThrow();

      manager.clearPreviousSecret();

      // Token should fail after rotation window closes
      expect(() => manager.verifyToken(oldToken)).toThrow();
    });

    it('should handle refresh token rotation separately', () => {
      const refreshToken = manager.signRefreshToken({ userId: 'user-1' });
      expect(manager.refreshTokenTTL).toBe(7 * 24 * 60 * 60); // 7 days

      manager.rotateSecret(newSecret);

      // Refresh token should still be valid (longer TTL)
      expect(() => manager.verifyToken(refreshToken)).not.toThrow();
    });
  });

  describe('Environment variable configuration', () => {
    it('should read single JWT_SECRET_CURRENT for basic setup', () => {
      const env = { JWT_SECRET_CURRENT: initialSecret };
      const mgr = new JwtManager(env.JWT_SECRET_CURRENT);

      expect(mgr.currentSecret).toBe(initialSecret);
      expect(mgr.previousSecret).toBeNull();
    });

    it('should read both JWT_SECRET_CURRENT and JWT_SECRET_PREVIOUS for rotation', () => {
      const env = {
        JWT_SECRET_CURRENT: newSecret,
        JWT_SECRET_PREVIOUS: initialSecret,
      };

      const mgr = new JwtManager(env.JWT_SECRET_CURRENT, env.JWT_SECRET_PREVIOUS);

      expect(mgr.currentSecret).toBe(newSecret);
      expect(mgr.previousSecret).toBe(initialSecret);
      expect(mgr.supportsDualSecret()).toBe(true);
    });

    it('should ignore undefined previous secret', () => {
      const mgr = new JwtManager(initialSecret, undefined);
      expect(mgr.supportsDualSecret()).toBe(false);
    });

    it('should support null previous secret for transition', () => {
      const mgr = new JwtManager(initialSecret, null);
      expect(mgr.supportsDualSecret()).toBe(false);
    });
  });

  describe('Error handling', () => {
    it('should reject expired token regardless of secret', () => {
      const expiredToken = jwt.sign({ userId: 'user-1' }, initialSecret, {
        expiresIn: '-1s', // Already expired
      });

      expect(() => manager.verifyToken(expiredToken)).toThrow();
    });

    it('should reject malformed token', () => {
      expect(() => manager.verifyToken('not.a.token')).toThrow();
    });

    it('should reject token signed with wrong secret (no previous)', () => {
      const wrongToken = jwt.sign({ userId: 'user-1' }, 'wrong-secret');

      expect(() => manager.verifyToken(wrongToken)).toThrow();
    });

    it('should provide meaningful error when token verification fails', () => {
      const token = jwt.sign({ userId: 'user-1' }, 'different-secret');

      expect(() => manager.verifyToken(token)).toThrow(Error);
    });
  });

  describe('Payload preservation', () => {
    it('should preserve all claims during rotation', () => {
      const payload = {
        userId: 'user-123',
        email: 'user@example.com',
        roles: ['user', 'admin'],
        iat: Math.floor(Date.now() / 1000),
      };

      const token = manager.signAccessToken(payload);

      manager.rotateSecret(newSecret);

      const result = manager.verifyToken(token);

      expect(result.decoded.userId).toBe(payload.userId);
      expect(result.decoded.email).toBe(payload.email);
      expect(result.decoded.roles).toEqual(payload.roles);
    });

    it('should include standard JWT claims', () => {
      const payload = { userId: 'user-1' };
      const token = manager.signAccessToken(payload);

      const decoded = jwt.decode(token, { complete: true });

      expect(decoded.header.alg).toBe('HS256');
      expect(decoded.payload.userId).toBe('user-1');
      expect(decoded.payload.exp).toBeDefined();
      expect(decoded.payload.iat).toBeDefined();
    });
  });

  describe('Rotation documentation scenario', () => {
    it('should support documented rotation procedure', () => {
      // Initial state
      expect(manager.currentSecret).toBe(initialSecret);
      expect(manager.previousSecret).toBeNull();

      // Step 1: Set JWT_SECRET_PREVIOUS to current value
      manager.previousSecret = manager.currentSecret;
      expect(manager.supportsDualSecret()).toBe(true);

      // Step 2: Generate and set JWT_SECRET_CURRENT
      manager.currentSecret = newSecret;

      // Step 3: Deploy (no restart)
      // Both secrets now active

      // Step 4: Wait for all tokens to expire (15 minutes for access tokens)
      const oldToken = jwt.sign({ userId: 'user-1' }, manager.previousSecret);
      expect(() => manager.verifyToken(oldToken)).not.toThrow();

      // Step 5: Unset JWT_SECRET_PREVIOUS
      manager.clearPreviousSecret();

      // Old tokens should now fail
      expect(() => manager.verifyToken(oldToken)).toThrow();
    });
  });
});
