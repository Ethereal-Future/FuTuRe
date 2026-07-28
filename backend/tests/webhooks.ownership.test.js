/**
 * Regression tests for issue #912 — IDOR on webhook delete / rotate-secret.
 *
 * A webhook registered by one account must not be deletable or rotatable
 * by a different authenticated account, even with a valid, guessed ID.
 * Both "doesn't exist" and "belongs to someone else" must return an
 * identical 404 response shape so existence isn't leaked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

let currentUser;

async function makeWebhooksApp() {
  vi.resetModules();

  vi.doMock('../src/middleware/auth.js', () => ({
    requireAuth: (req, _res, next) => {
      req.user = currentUser;
      next();
    },
  }));

  vi.doMock('../src/config/logger.js', () => ({
    default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  }));

  vi.doMock('../src/db/client.js', () => ({
    default: {
      webhookDelivery: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    },
  }));

  const { default: webhooksRouter } = await import('../src/routes/webhooks.js');

  const app = express();
  app.use(express.json());
  app.use('/', webhooksRouter);
  return app;
}

describe('Webhook ownership checks (issue #912)', () => {
  const accountA = 'account-a';
  const accountB = 'account-b';
  let app;

  beforeEach(async () => {
    currentUser = { sub: accountA };
    app = await makeWebhooksApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function registerWebhook(accountId, url = 'https://example.com/hook') {
    currentUser = { sub: accountId };
    const res = await request(app)
      .post('/')
      .send({ url, events: ['*'] });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it('rejects cross-account delete with 404', async () => {
    const webhookId = await registerWebhook(accountA);

    currentUser = { sub: accountB };
    const res = await request(app).delete(`/${webhookId}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Webhook not found' });
  });

  it('rejects cross-account rotate-secret with 404', async () => {
    const webhookId = await registerWebhook(accountA);

    currentUser = { sub: accountB };
    const res = await request(app).post(`/${webhookId}/rotate-secret`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Webhook not found' });
  });

  it('returns an identical 404 shape for a nonexistent webhook as for a cross-account one', async () => {
    const webhookId = await registerWebhook(accountA);

    currentUser = { sub: accountB };
    const crossAccount = await request(app).delete(`/${webhookId}`);
    const nonexistent = await request(app).delete('/does-not-exist');

    expect(crossAccount.status).toBe(nonexistent.status);
    expect(crossAccount.body).toEqual(nonexistent.body);
  });

  it('allows the owning account to delete its own webhook', async () => {
    const webhookId = await registerWebhook(accountA);

    currentUser = { sub: accountA };
    const res = await request(app).delete(`/${webhookId}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Webhook deleted' });
  });

  it('allows the owning account to rotate its own webhook secret', async () => {
    const webhookId = await registerWebhook(accountA);

    currentUser = { sub: accountA };
    const res = await request(app).post(`/${webhookId}/rotate-secret`);

    expect(res.status).toBe(200);
    expect(res.body.signingSecret).toBeDefined();
  });

  it('does not allow account B to delete a webhook it does not own even after registering its own', async () => {
    const webhookIdA = await registerWebhook(accountA);
    await registerWebhook(accountB);

    currentUser = { sub: accountB };
    const res = await request(app).delete(`/${webhookIdA}`);

    expect(res.status).toBe(404);
  });
});
