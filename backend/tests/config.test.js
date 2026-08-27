import { describe, it, expect } from 'vitest';
import { createConfigFromEnv } from '../src/config/env.js';
import { encryptToEnvValue } from '../src/config/secrets.js';

describe('Configuration Management', () => {
  it('should apply sensible defaults', () => {
    const cfg = createConfigFromEnv({});
    expect(cfg.server.port).toBe(3001);
    expect(cfg.stellar.network).toBe('testnet');
    expect(cfg.stellar.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    expect(cfg.cors.allowedOrigins).toContain('http://localhost:3000');
    expect(cfg.security.jwtSecret).toBe('secret');
  });

  it('should enforce production requirements', () => {
    expect(() => createConfigFromEnv({ APP_ENV: 'production', JWT_SECRET: 'x' })).toThrow(
      /ALLOWED_ORIGINS is required in production/
    );

    expect(() => createConfigFromEnv({ APP_ENV: 'production', ALLOWED_ORIGINS: 'https://example.com' })).toThrow(
      /JWT_SECRET is required/
    );

    expect(() => createConfigFromEnv({
      APP_ENV: 'production',
      ALLOWED_ORIGINS: 'https://example.com',
      JWT_SECRET: 'secret',
    })).toThrow(/JWT_SECRET must not be the default value/);
  });

  it('should validate config version compatibility', () => {
    expect(() => createConfigFromEnv({ CONFIG_VERSION: '2' })).toThrow(/Unsupported CONFIG_VERSION=2/);
  });

  it('should decrypt encrypted secrets when CONFIG_ENCRYPTION_KEY is provided', () => {
    const key = 'test-key';
    const encrypted = encryptToEnvValue('supersecret', key);

    const cfg = createConfigFromEnv({
      APP_ENV: 'production',
      ALLOWED_ORIGINS: 'https://example.com',
      CONFIG_ENCRYPTION_KEY: key,
      JWT_SECRET: encrypted,
    });

    expect(cfg.security.jwtSecret).toBe('supersecret');
  });

  it('should error on encrypted secrets without CONFIG_ENCRYPTION_KEY', () => {
    const encrypted = encryptToEnvValue('supersecret', 'test-key');

    expect(() => createConfigFromEnv({
      APP_ENV: 'production',
      ALLOWED_ORIGINS: 'https://example.com',
      JWT_SECRET: encrypted,
    })).toThrow(/Missing CONFIG_ENCRYPTION_KEY for JWT_SECRET/);
  });
});

const DEPLOYED_BASE = {
  STREAM_SECRET_ENCRYPTION_KEY: 'x'.repeat(32),
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
  ALLOWED_ORIGINS: 'https://example.com',
};

describe('#1112 JWT secret fail-closed validation', () => {
  it('allows the default JWT_SECRET only in development and test', () => {
    const dev = createConfigFromEnv({ ...DEPLOYED_BASE, APP_ENV: 'development' });
    expect(dev.security.jwtSecret).toBe('secret');

    const testEnv = createConfigFromEnv({ ...DEPLOYED_BASE, APP_ENV: 'test' });
    expect(testEnv.security.jwtSecret).toBe('secret');
  });

  it('fails to boot when APP_ENV is unrecognized (preprod) and JWT_SECRET is unset', () => {
    expect(() =>
      createConfigFromEnv({
        ...DEPLOYED_BASE,
        APP_ENV: 'preprod',
      }),
    ).toThrow(/JWT_SECRET is required/);
  });

  it('rejects the hardcoded default JWT_SECRET for unrecognized APP_ENV', () => {
    expect(() =>
      createConfigFromEnv({
        ...DEPLOYED_BASE,
        APP_ENV: 'preprod',
        JWT_SECRET: 'secret',
      }),
    ).toThrow(/JWT_SECRET must not be the default value/);
  });

  it('requires a real JWT_SECRET for staging', () => {
    expect(() =>
      createConfigFromEnv({
        ...DEPLOYED_BASE,
        APP_ENV: 'staging',
      }),
    ).toThrow(/JWT_SECRET is required/);
  });

  it('requires ALLOWED_ORIGINS for unrecognized APP_ENV (same fail-closed pattern)', () => {
    expect(() =>
      createConfigFromEnv({
        STREAM_SECRET_ENCRYPTION_KEY: DEPLOYED_BASE.STREAM_SECRET_ENCRYPTION_KEY,
        DATABASE_URL: DEPLOYED_BASE.DATABASE_URL,
        APP_ENV: 'demo',
        JWT_SECRET: 'a-real-non-default-secret',
      }),
    ).toThrow(/ALLOWED_ORIGINS is required/);
  });
});

