import { describe, it, expect, beforeEach } from 'vitest';
import { registerWebhook, signPayload, verifyWebhookSignature, rotateWebhookSecret } from '../src/webhooks/store.js';

describe('Webhook Signature Verification', () => {
  let webhook;
  const testAccountId = 'test-account-123';

  beforeEach(() => {
    webhook = registerWebhook({
      url: 'https://example.com/webhook',
      accountId: testAccountId,
      events: ['payment.sent', 'payment.received'],
    });
  });

  it('should sign payload with HMAC-SHA256', () => {
    const payload = { type: 'payment.sent', amount: 100 };
    const signature = signPayload(webhook.signingSecret, payload);

    expect(signature).toBeDefined();
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);
  });

  it('should verify valid webhook signature', () => {
    const payload = { type: 'payment.sent', amount: 100, timestamp: Date.now() };
    const signature = signPayload(webhook.signingSecret, payload);

    const valid = verifyWebhookSignature(webhook.id, signature, payload);
    expect(valid).toBe(true);
  });

  it('should reject invalid webhook signature', () => {
    const payload = { type: 'payment.sent', amount: 100 };
    const invalidSignature = 'invalid_signature_12345';

    const valid = verifyWebhookSignature(webhook.id, invalidSignature, payload);
    expect(valid).toBe(false);
  });

  it('should reject signature for non-existent webhook', () => {
    const payload = { type: 'payment.sent', amount: 100 };
    const signature = signPayload('some-secret', payload);

    const valid = verifyWebhookSignature('non-existent-id', signature, payload);
    expect(valid).toBe(false);
  });

  it('should include signature in X-FuTuRe-Signature header format', () => {
    const payload = { type: 'payment.sent', amount: 100 };
    const signature = signPayload(webhook.signingSecret, payload);

    // Signature should be in format: sha256=<hex>
    const headerValue = `sha256=${signature}`;
    expect(headerValue).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('should rotate webhook secret', () => {
    const oldSecret = webhook.signingSecret;
    const payload = { type: 'payment.sent', amount: 100 };

    // Sign with old secret
    const oldSignature = signPayload(oldSecret, payload);

    // Rotate secret
    const result = rotateWebhookSecret(webhook.id);
    expect(result.signingSecret).toBeDefined();
    expect(result.signingSecret).not.toBe(oldSecret);

    // Old signature should still be valid (grace period)
    const valid = verifyWebhookSignature(webhook.id, oldSignature, payload);
    expect(valid).toBe(true);

    // New signature should also be valid
    const newSignature = signPayload(result.signingSecret, payload);
    const newValid = verifyWebhookSignature(webhook.id, newSignature, payload);
    expect(newValid).toBe(true);
  });

  it('should maintain previous secrets for rotation grace period', () => {
    const payload = { type: 'payment.sent', amount: 100 };

    // Rotate multiple times
    const secret1 = webhook.signingSecret;
    const sig1 = signPayload(secret1, payload);

    rotateWebhookSecret(webhook.id);
    const secret2 = webhook.signingSecret;
    const sig2 = signPayload(secret2, payload);

    rotateWebhookSecret(webhook.id);
    const secret3 = webhook.signingSecret;
    const sig3 = signPayload(secret3, payload);

    // All three signatures should be valid
    expect(verifyWebhookSignature(webhook.id, sig1, payload)).toBe(true);
    expect(verifyWebhookSignature(webhook.id, sig2, payload)).toBe(true);
    expect(verifyWebhookSignature(webhook.id, sig3, payload)).toBe(true);
  });

  it('should detect tampered payload', () => {
    const payload = { type: 'payment.sent', amount: 100 };
    const signature = signPayload(webhook.signingSecret, payload);

    // Tamper with payload
    const tamperedPayload = { type: 'payment.sent', amount: 1000 };

    const valid = verifyWebhookSignature(webhook.id, signature, tamperedPayload);
    expect(valid).toBe(false);
  });

  it('should produce consistent signatures for same payload', () => {
    const payload = { type: 'payment.sent', amount: 100 };

    const sig1 = signPayload(webhook.signingSecret, payload);
    const sig2 = signPayload(webhook.signingSecret, payload);

    expect(sig1).toBe(sig2);
  });
});
