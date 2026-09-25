/**
 * JWT verification security hardening tests
 */

import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
  verifyRefreshToken,
} from '../src/auth/tokens.js';

vi.mock('../src/config/env.js', () => ({
  getConfig: () => ({
    security: { jwtSecret: 'test-secret-key' },
  }),
}));

describe('JWT Token Verification Security', () => {
  const testPayload = {
    sub: 'user123',
    username: 'testuser',
    role: 'USER',
  };

  describe('Access Token', () => {
    it('should sign access token with correct algorithm and audience', () => {
      const token = signAccessToken(testPayload);
      const decoded = jwt.decode(token, { complete: true });

      expect(decoded.header.alg).toBe('HS256');
      expect(decoded.payload.iss).toBe('future-app');
      expect(decoded.payload.aud).toBe('future-api');
    });

    it('should verify access token with valid credentials', () => {
      const token = signAccessToken(testPayload);
      const decoded = verifyToken(token);

      expect(decoded.sub).toBe('testuser');
      expect(decoded.username).toBe('testuser');
      expect(decoded.role).toBe('USER');
    });

    it('should reject access token with wrong audience', () => {
      const secret = 'test-secret-key';
      const malformedToken = jwt.sign(testPayload, secret, {
        algorithm: 'HS256',
        issuer: 'future-app',
        audience: 'wrong-audience',
      });

      expect(() => verifyToken(malformedToken)).toThrow();
    });

    it('should reject access token with wrong issuer', () => {
      const secret = 'test-secret-key';
      const malformedToken = jwt.sign(testPayload, secret, {
        algorithm: 'HS256',
        issuer: 'wrong-issuer',
        audience: 'future-api',
      });

      expect(() => verifyToken(malformedToken)).toThrow();
    });

    it('should reject access token signed with wrong algorithm', () => {
      const secret = 'test-secret-key';
      const malformedToken = jwt.sign(testPayload, secret, {
        algorithm: 'HS512', // Wrong algorithm
        issuer: 'future-app',
        audience: 'future-api',
      });

      expect(() => verifyToken(malformedToken)).toThrow();
    });
  });

  describe('Refresh Token', () => {
    it('should sign refresh token with correct algorithm and audience', () => {
      const token = signRefreshToken(testPayload);
      const decoded = jwt.decode(token, { complete: true });

      expect(decoded.header.alg).toBe('HS256');
      expect(decoded.payload.iss).toBe('future-app');
      expect(decoded.payload.aud).toBe('future-refresh');
    });

    it('should verify refresh token with valid credentials', () => {
      const token = signRefreshToken(testPayload);
      const decoded = verifyRefreshToken(token);

      expect(decoded.sub).toBe('testuser');
      expect(decoded.username).toBe('testuser');
      expect(decoded.role).toBe('USER');
    });

    it('should reject refresh token when verified as access token', () => {
      const token = signRefreshToken(testPayload);
      expect(() => verifyToken(token)).toThrow();
    });

    it('should reject access token when verified as refresh token', () => {
      const token = signAccessToken(testPayload);
      expect(() => verifyRefreshToken(token)).toThrow();
    });

    it('should reject refresh token with wrong audience', () => {
      const secret = 'test-secret-key';
      const malformedToken = jwt.sign(testPayload, secret, {
        algorithm: 'HS256',
        issuer: 'future-app',
        audience: 'wrong-audience',
      });

      expect(() => verifyRefreshToken(malformedToken)).toThrow();
    });

    it('should reject refresh token with wrong issuer', () => {
      const secret = 'test-secret-key';
      const malformedToken = jwt.sign(testPayload, secret, {
        algorithm: 'HS256',
        issuer: 'wrong-issuer',
        audience: 'future-refresh',
      });

      expect(() => verifyRefreshToken(malformedToken)).toThrow();
    });

    it('should reject refresh token signed with wrong algorithm', () => {
      const secret = 'test-secret-key';
      const malformedToken = jwt.sign(testPayload, secret, {
        algorithm: 'RS256', // Wrong algorithm
        issuer: 'future-app',
        audience: 'future-refresh',
      });

      expect(() => verifyRefreshToken(malformedToken)).toThrow();
    });
  });

  describe('Token Isolation', () => {
    it('should enforce algorithm pinning to HS256 only', () => {
      const secret = 'test-secret-key';

      // Try to use a different algorithm
      const attackToken = jwt.sign(testPayload, secret, {
        algorithm: 'none', // Attempt "none" algorithm attack
        issuer: 'future-app',
        audience: 'future-api',
      });

      expect(() => verifyToken(attackToken)).toThrow();
    });

    it('should prevent cross-token-type attacks', () => {
      const accessToken = signAccessToken(testPayload);
      const refreshToken = signRefreshToken(testPayload);

      // Access token should not verify as refresh token
      expect(() => verifyRefreshToken(accessToken)).toThrow();

      // Refresh token should not verify as access token
      expect(() => verifyToken(refreshToken)).toThrow();
    });
  });
});
