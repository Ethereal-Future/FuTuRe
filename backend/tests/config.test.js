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

