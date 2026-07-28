/**
 * Regression tests for issue #913 — SSRF via unvalidated webhook URLs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateWebhookUrl } from '../src/webhooks/urlValidator.js';

describe('validateWebhookUrl', () => {
  beforeEach(() => {
    delete process.env.WEBHOOK_HOST_ALLOWLIST;
  });

  it('rejects a malformed URL', async () => {
    const result = await validateWebhookUrl('not-a-url');
    expect(result.valid).toBe(false);
  });

  it('rejects a missing URL', async () => {
    const result = await validateWebhookUrl('');
    expect(result.valid).toBe(false);
  });

  it('rejects an overly long URL', async () => {
    const longUrl = `https://1.2.3.4/${'a'.repeat(3000)}`;
    const result = await validateWebhookUrl(longUrl);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/exceed/);
  });

  it('rejects a disallowed scheme', async () => {
    const result = await validateWebhookUrl('file:///etc/passwd');
    expect(result.valid).toBe(false);
  });

  it('rejects loopback IPs', async () => {
    const result = await validateWebhookUrl('https://127.0.0.1/hook');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/private|loopback|link-local/);
  });

  it('rejects the cloud metadata link-local address', async () => {
    const result = await validateWebhookUrl('https://169.254.169.254/latest/meta-data/');
    expect(result.valid).toBe(false);
  });

  it('rejects RFC1918 private ranges', async () => {
    for (const ip of ['10.0.0.5', '172.16.0.5', '192.168.1.5']) {
      const result = await validateWebhookUrl(`https://${ip}/hook`);
      expect(result.valid).toBe(false);
    }
  });

  it('rejects http:// in production configuration', async () => {
    const result = await validateWebhookUrl('http://93.184.216.34/hook', { appEnv: 'production' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/https/);
  });

  it('accepts a valid public https URL', async () => {
    const result = await validateWebhookUrl('https://93.184.216.34/hook', { appEnv: 'production' });
    expect(result.valid).toBe(true);
  });

  it('accepts http:// outside production/staging', async () => {
    const result = await validateWebhookUrl('http://93.184.216.34/hook', { appEnv: 'development' });
    expect(result.valid).toBe(true);
  });

  it('resolves hostnames via DNS and rejects ones that resolve to a private range', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    const result = await validateWebhookUrl('https://internal.example.com/hook', {
      appEnv: 'production',
      lookup,
    });
    expect(result.valid).toBe(false);
    expect(lookup).toHaveBeenCalledWith('internal.example.com', { all: true, verbatim: true });
  });

  it('resolves hostnames via DNS and accepts ones that resolve to a public range', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const result = await validateWebhookUrl('https://public.example.com/hook', {
      appEnv: 'production',
      lookup,
    });
    expect(result.valid).toBe(true);
  });

  it('simulates DNS rebinding: registration-time public IP vs. dispatch-time private IP', async () => {
    const registrationLookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const atRegistration = await validateWebhookUrl('https://rebinding.example.com/hook', {
      appEnv: 'production',
      lookup: registrationLookup,
    });
    expect(atRegistration.valid).toBe(true);

    const dispatchLookup = vi.fn().mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
    const atDispatch = await validateWebhookUrl('https://rebinding.example.com/hook', {
      appEnv: 'production',
      lookup: dispatchLookup,
    });
    expect(atDispatch.valid).toBe(false);
  });

  it('allows an explicitly allowlisted host regardless of scheme or IP range', async () => {
    process.env.WEBHOOK_HOST_ALLOWLIST = 'localhost';
    vi.resetModules();
    const { validateWebhookUrl: validate } = await import('../src/webhooks/urlValidator.js');
    const result = await validate('http://localhost:4000/hook', { appEnv: 'production' });
    expect(result.valid).toBe(true);
  });
});
