/**
 * #1123 — RFC 8291 / VAPID Web Push sender.
 *
 * Verifies:
 *  - VAPID credentials are configured on the `web-push` package from env vars
 *  - sendNotification (real encryption/signing, not a raw HTTPS POST) is used
 *  - 404/410 responses from the push service prune the dead subscription
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendNotificationMock = vi.fn();
const setVapidDetailsMock = vi.fn();

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: (...args) => setVapidDetailsMock(...args),
    sendNotification: (...args) => sendNotificationMock(...args),
  },
}));

vi.mock('../src/config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const SUBSCRIPTION = {
  endpoint: 'https://push.example.com/sub/abc123',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

describe('#1123 - webPush (VAPID + web-push package)', () => {
  beforeEach(() => {
    vi.resetModules();
    sendNotificationMock.mockReset();
    setVapidDetailsMock.mockReset();
  });

  it('configures VAPID details from env vars at module load', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    process.env.VAPID_SUBJECT = 'mailto:ops@example.com';

    const webPush = await import('../src/notifications/webPush.js');

    expect(setVapidDetailsMock).toHaveBeenCalledWith(
      'mailto:ops@example.com',
      'test-public-key',
      'test-private-key',
    );
    expect(webPush.isVapidConfigured()).toBe(true);

    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  it('skips sending and reports vapid_not_configured when keys are missing', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const webPush = await import('../src/notifications/webPush.js');
    expect(webPush.isVapidConfigured()).toBe(false);

    const result = await webPush.sendWebPush(SUBSCRIPTION, { title: 't', body: 'b' });
    expect(result).toEqual({ sent: false, reason: 'vapid_not_configured' });
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it('sends via webpush.sendNotification with vapidDetails (RFC 8291 encryption + VAPID auth)', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
    process.env.VAPID_SUBJECT = 'mailto:ops@example.com';

    sendNotificationMock.mockResolvedValue({ statusCode: 201 });

    const webPush = await import('../src/notifications/webPush.js');
    const result = await webPush.sendWebPush(SUBSCRIPTION, { title: 'Hi', body: 'There' });

    expect(result).toEqual({ sent: true, status: 201 });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    const [sentSubscription, sentPayload, sentOptions] = sendNotificationMock.mock.calls[0];
    expect(sentSubscription).toBe(SUBSCRIPTION);
    expect(JSON.parse(sentPayload)).toEqual({ title: 'Hi', body: 'There' });
    expect(sentOptions.vapidDetails).toEqual({
      subject: 'mailto:ops@example.com',
      publicKey: 'test-public-key',
      privateKey: 'test-private-key',
    });

    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  it('prunes the subscription on a 410 Gone response and reports subscription_expired', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';

    const goneError = Object.assign(new Error('Gone'), { statusCode: 410 });
    sendNotificationMock.mockRejectedValue(goneError);

    const webPush = await import('../src/notifications/webPush.js');
    webPush.saveSubscription('user-1', SUBSCRIPTION, 'GPUBLICKEY123');

    expect(webPush.getSubscription('user-1')).toEqual(SUBSCRIPTION);
    expect(webPush.getSubscriptionByPublicKey('GPUBLICKEY123')).toEqual(SUBSCRIPTION);

    const result = await webPush.sendWebPush(SUBSCRIPTION, { title: 't', body: 'b' });

    expect(result).toEqual({ sent: false, reason: 'subscription_expired', status: 410 });
    expect(webPush.getSubscription('user-1')).toBeNull();
    expect(webPush.getSubscriptionByPublicKey('GPUBLICKEY123')).toBeNull();

    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it('prunes the subscription on a 404 Not Found response', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';

    const notFoundError = Object.assign(new Error('Not Found'), { statusCode: 404 });
    sendNotificationMock.mockRejectedValue(notFoundError);

    const webPush = await import('../src/notifications/webPush.js');
    webPush.saveSubscription('user-2', SUBSCRIPTION, 'GPUBLICKEY456');

    const result = await webPush.sendWebPush(SUBSCRIPTION, { title: 't', body: 'b' });

    expect(result.sent).toBe(false);
    expect(result.reason).toBe('subscription_expired');
    expect(webPush.getSubscription('user-2')).toBeNull();

    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it('does not prune the subscription on transient errors (e.g. 500)', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';

    const serverError = Object.assign(new Error('Internal Server Error'), { statusCode: 500 });
    sendNotificationMock.mockRejectedValue(serverError);

    const webPush = await import('../src/notifications/webPush.js');
    webPush.saveSubscription('user-3', SUBSCRIPTION, 'GPUBLICKEY789');

    const result = await webPush.sendWebPush(SUBSCRIPTION, { title: 't', body: 'b' });

    expect(result.sent).toBe(false);
    expect(result.status).toBe(500);
    // Still present — a transient failure should not evict a live subscription.
    expect(webPush.getSubscription('user-3')).toEqual(SUBSCRIPTION);

    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it('returns no_subscription without calling web-push when endpoint is missing', async () => {
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';

    const webPush = await import('../src/notifications/webPush.js');
    const result = await webPush.sendWebPush(null, { title: 't', body: 'b' });

    expect(result).toEqual({ sent: false, reason: 'no_subscription' });
    expect(sendNotificationMock).not.toHaveBeenCalled();

    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });
});
