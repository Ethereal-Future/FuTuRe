/**
 * Webhook signature & secret-rotation tests.
 *
 * store.js now persists to PostgreSQL via Prisma, so we mock the Prisma client
 * to keep these tests fast and dependency-free.  The mock simulates a minimal
 * in-memory store so the full store logic (HMAC, rotation, grace-period) is
 * still exercised — only the DB calls are replaced.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Prisma mock — must be declared before importing store.js so vi.mock hoisting
// picks it up.
// ---------------------------------------------------------------------------

const webhookStore = new Map();

vi.mock('../src/db/client.js', () => {
  const webhookMethods = {
    count: vi.fn(({ where }) => {
      let n = 0;
      for (const w of webhookStore.values()) {
        if (w.accountId === where.accountId && w.deletedAt == null) n++;
      }
      return Promise.resolve(n);
    }),

    create: vi.fn(({ data }) => {
      const row = {
        id: `wh-${Math.random().toString(36).slice(2)}`,
        previousSecrets: [],
        createdAt: new Date(),
        lastRotatedAt: new Date(),
        deletedAt: null,
        ...data,
      };
      webhookStore.set(row.id, row);
      return Promise.resolve(row);
    }),

    findFirst: vi.fn(({ where }) => {
      const row = webhookStore.get(where.id);
      if (!row || row.deletedAt != null) return Promise.resolve(null);
      return Promise.resolve(row);
    }),

    findMany: vi.fn(({ where }) => {
      const rows = [...webhookStore.values()].filter(
        (w) => (!where.accountId || w.accountId === where.accountId) && w.deletedAt == null,
      );
      return Promise.resolve(rows);
    }),

    updateMany: vi.fn(({ where, data }) => {
      const row = webhookStore.get(where.id);
      if (!row || row.deletedAt != null) return Promise.resolve({ count: 0 });
      Object.assign(row, data);
      return Promise.resolve({ count: 1 });
    }),

    update: vi.fn(({ where, data }) => {
      const row = webhookStore.get(where.id);
      if (!row) return Promise.resolve(null);
      Object.assign(row, data);
      return Promise.resolve(row);
    }),
  };

  return { default: { webhook: webhookMethods } };
});

// ---------------------------------------------------------------------------
// Import store AFTER mock is in place.
// ---------------------------------------------------------------------------
import {
  registerWebhook,
  signPayload,
  verifyWebhookSignature,
  rotateWebhookSecret,
  MAX_WEBHOOKS_PER_ACCOUNT,
} from '../src/webhooks/store.js';

describe('Webhook Signature Verification', () => {
  let webhook;
  const testAccountId = 'test-account-123';

  beforeEach(async () => {
    webhookStore.clear();
    webhook = await registerWebhook({
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

  it('should verify valid webhook signature', async () => {
    const payload = { type: 'payment.sent', amount: 100, timestamp: Date.now() };
    const signature = signPayload(webhook.signingSecret, payload);

    const valid = await verifyWebhookSignature(webhook.id, signature, payload);
    expect(valid).toBe(true);
  });

  it('should reject invalid webhook signature', async () => {
    const payload = { type: 'payment.sent', amount: 100 };
    const invalidSignature = 'invalid_signature_12345';

    const valid = await verifyWebhookSignature(webhook.id, invalidSignature, payload);
    expect(valid).toBe(false);
  });

  it('should reject signature for non-existent webhook', async () => {
    const payload = { type: 'payment.sent', amount: 100 };
    const signature = signPayload('some-secret', payload);

    const valid = await verifyWebhookSignature('non-existent-id', signature, payload);
    expect(valid).toBe(false);
  });

  it('should include signature in X-FuTuRe-Signature header format', () => {
    const payload = { type: 'payment.sent', amount: 100 };
    const signature = signPayload(webhook.signingSecret, payload);

    const headerValue = `sha256=${signature}`;
    expect(headerValue).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('should rotate webhook secret', async () => {
    const oldSecret = webhook.signingSecret;
    const payload = { type: 'payment.sent', amount: 100 };

    const oldSignature = signPayload(oldSecret, payload);

    const result = await rotateWebhookSecret(webhook.id);
    expect(result.signingSecret).toBeDefined();
    expect(result.signingSecret).not.toBe(oldSecret);

    // Old signature should still be valid (grace period).
    const valid = await verifyWebhookSignature(webhook.id, oldSignature, payload);
    expect(valid).toBe(true);

    // New signature should also be valid.
    const newSignature = signPayload(result.signingSecret, payload);
    const newValid = await verifyWebhookSignature(webhook.id, newSignature, payload);
    expect(newValid).toBe(true);
  });

  it('should maintain previous secrets for rotation grace period', async () => {
    const payload = { type: 'payment.sent', amount: 100 };

    const secret1 = webhook.signingSecret;
    const sig1 = signPayload(secret1, payload);

    await rotateWebhookSecret(webhook.id);
    // Fetch updated secret from store.
    const secret2 = webhookStore.get(webhook.id).signingSecret;
    const sig2 = signPayload(secret2, payload);

    await rotateWebhookSecret(webhook.id);
    const secret3 = webhookStore.get(webhook.id).signingSecret;
    const sig3 = signPayload(secret3, payload);

    // All three signatures must still verify (up to 2 previous secrets kept).
    expect(await verifyWebhookSignature(webhook.id, sig1, payload)).toBe(true);
    expect(await verifyWebhookSignature(webhook.id, sig2, payload)).toBe(true);
    expect(await verifyWebhookSignature(webhook.id, sig3, payload)).toBe(true);
  });

  it('should detect tampered payload', async () => {
    const payload = { type: 'payment.sent', amount: 100 };
    const signature = signPayload(webhook.signingSecret, payload);

    const tamperedPayload = { type: 'payment.sent', amount: 1000 };

    const valid = await verifyWebhookSignature(webhook.id, signature, tamperedPayload);
    expect(valid).toBe(false);
  });

  it('should produce consistent signatures for same payload', () => {
    const payload = { type: 'payment.sent', amount: 100 };

    const sig1 = signPayload(webhook.signingSecret, payload);
    const sig2 = signPayload(webhook.signingSecret, payload);

    expect(sig1).toBe(sig2);
  });
});

describe('Per-account webhook cap', () => {
  const capAccountId = 'cap-account-456';

  beforeEach(() => {
    webhookStore.clear();
  });

  it(`enforces the ${MAX_WEBHOOKS_PER_ACCOUNT}-webhook cap per account`, async () => {
    // Register up to the cap.
    for (let i = 0; i < MAX_WEBHOOKS_PER_ACCOUNT; i++) {
      await registerWebhook({
        url: `https://example.com/hook-${i}`,
        accountId: capAccountId,
        events: ['*'],
      });
    }

    // The next registration must throw.
    await expect(
      registerWebhook({
        url: 'https://example.com/hook-overflow',
        accountId: capAccountId,
        events: ['*'],
      }),
    ).rejects.toThrow('Webhook limit reached');
  });

  it('does not count webhooks belonging to other accounts toward the cap', async () => {
    // Fill cap for a different account.
    for (let i = 0; i < MAX_WEBHOOKS_PER_ACCOUNT; i++) {
      await registerWebhook({
        url: `https://example.com/other-${i}`,
        accountId: 'other-account',
        events: ['*'],
      });
    }

    // capAccountId should still be able to register.
    await expect(
      registerWebhook({
        url: 'https://example.com/my-hook',
        accountId: capAccountId,
        events: ['*'],
      }),
    ).resolves.toBeDefined();
  });
});

describe('Persistence simulation (fresh Prisma client)', () => {
  beforeEach(() => {
    webhookStore.clear();
  });

  it('webhooks registered before a simulated restart are visible after', async () => {
    // Register a webhook (writes to the mocked "DB" — the shared webhookStore Map).
    const wh = await registerWebhook({
      url: 'https://example.com/persist-test',
      accountId: 'persist-account',
      events: ['payment.sent'],
    });

    // Simulate a process restart: re-import the store module with a fresh
    // module context.  Because vi.mock hoisting keeps the same webhookStore
    // Map (shared module-level state), the registered webhook survives — this
    // mirrors what real PostgreSQL persistence gives us.
    vi.resetModules();
    const { getWebhook: freshGetWebhook } = await import('../src/webhooks/store.js');

    const found = await freshGetWebhook(wh.id);
    expect(found).not.toBeNull();
    expect(found.id).toBe(wh.id);
    expect(found.accountId).toBe('persist-account');
  });

  it('soft-deleted webhooks are not returned after restart', async () => {
    const wh = await registerWebhook({
      url: 'https://example.com/delete-persist',
      accountId: 'delete-account',
      events: ['*'],
    });

    const { deleteWebhook: freshDelete, getWebhook: freshGet } = await import(
      '../src/webhooks/store.js'
    );

    await freshDelete(wh.id);

    vi.resetModules();
    const { getWebhook: restartedGet } = await import('../src/webhooks/store.js');

    const found = await restartedGet(wh.id);
    expect(found).toBeNull();
  });
});
