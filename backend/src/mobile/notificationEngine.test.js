/**
 * Automatic pruning of expired FCM / APNS push tokens (#1384).
 *
 * Prisma is replaced with an in-memory `UserDevice` table; FCM and APNS are
 * stubbed with the response shapes of Firebase Admin `sendEachForMulticast`
 * and an APNS HTTP/2 client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const devices = vi.hoisted(() => new Map()); // token -> row

vi.mock('../db/client.js', () => ({
  default: {
    userDevice: {
      findMany: vi.fn(async ({ where }) =>
        [...devices.values()]
          .filter((d) => where.userId.in.includes(d.userId))
          .map(({ token, platform }) => ({ token, platform })),
      ),
      deleteMany: vi.fn(async ({ where }) => {
        let count = 0;
        for (const token of where.token.in) {
          if (devices.delete(token)) count += 1;
        }
        return { count };
      }),
      upsert: vi.fn(async ({ where, create, update }) => {
        const row = devices.has(where.token)
          ? Object.assign(devices.get(where.token), update)
          : { ...create };
        devices.set(where.token, row);
        return row;
      }),
    },
  },
}));

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { default: prisma } = await import('../db/client.js');
const { default: logger } = await import('../config/logger.js');
const { NotificationEngine } = await import('./notificationEngine.js');

const payload = { title: 'Payment received', body: 'You received 10 XLM', data: { amount: 10 } };

function seed(token, platform, userId = 'user-1') {
  devices.set(token, { userId, deviceId: `device-${token}`, token, platform });
}

function fcmError(code) {
  return { success: false, error: { code, message: code } };
}

/** FCM stub: `outcomes` maps token -> error code (anything absent succeeds). */
function fakeFcm(outcomes = {}) {
  return {
    sendEachForMulticast: vi.fn(async ({ tokens }) => {
      const responses = tokens.map((t) =>
        outcomes[t] ? fcmError(outcomes[t]) : { success: true, messageId: `m-${t}` },
      );
      return {
        responses,
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
      };
    }),
  };
}

/** APNS stub: `statuses` maps token -> HTTP/2 status (default 200). */
function fakeApns(statuses = {}) {
  return {
    send: vi.fn(async (token) => {
      const status = statuses[token] ?? 200;
      if (status === 200) return { status };
      return { status, reason: status === 410 ? 'Unregistered' : 'BadDeviceToken' };
    }),
  };
}

describe('NotificationEngine — expired push token pruning (#1384)', () => {
  beforeEach(() => {
    devices.clear();
    vi.clearAllMocks();
  });

  it('deletes FCM tokens reported as not-registered or invalid in one batch query', async () => {
    seed('fcm-ok', 'android');
    seed('fcm-expired', 'android');
    seed('fcm-invalid', 'android');
    const engine = new NotificationEngine({
      fcm: fakeFcm({
        'fcm-expired': 'messaging/registration-token-not-registered',
        'fcm-invalid': 'messaging/invalid-argument',
      }),
    });

    const result = await engine.broadcastPush(['user-1'], payload);

    expect(prisma.userDevice.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.userDevice.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: expect.arrayContaining(['fcm-expired', 'fcm-invalid']) } },
    });
    expect([...devices.keys()]).toEqual(['fcm-ok']);
    expect(result).toMatchObject({ successCount: 1, failureCount: 2 });
    expect(result.prunedTokens.sort()).toEqual(['fcm-expired', 'fcm-invalid']);
  });

  it('deletes APNS tokens that return 410 Unregistered', async () => {
    seed('apns-ok', 'ios');
    seed('apns-gone', 'ios');
    const engine = new NotificationEngine({ apns: fakeApns({ 'apns-gone': 410 }) });

    const result = await engine.broadcastPush(['user-1'], payload);

    expect(prisma.userDevice.deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['apns-gone'] } },
    });
    expect(devices.has('apns-gone')).toBe(false);
    expect(devices.has('apns-ok')).toBe(true);
    expect(result.prunedTokens).toEqual(['apns-gone']);
  });

  it('handles APNS clients that reject with the 410 response', async () => {
    seed('apns-gone', 'ios');
    const apns = {
      send: vi.fn(async () => {
        throw Object.assign(new Error('Unregistered'), { status: 410, reason: 'Unregistered' });
      }),
    };
    const engine = new NotificationEngine({ apns });

    const result = await engine.broadcastPush(['user-1'], payload);

    expect(result.prunedTokens).toEqual(['apns-gone']);
    expect(devices.size).toBe(0);
  });

  it('prunes FCM and APNS tokens together in a single deleteMany', async () => {
    seed('fcm-expired', 'android');
    seed('apns-gone', 'ios');
    seed('apns-ok', 'ios');
    const engine = new NotificationEngine({
      fcm: fakeFcm({ 'fcm-expired': 'messaging/registration-token-not-registered' }),
      apns: fakeApns({ 'apns-gone': 410 }),
    });

    await engine.broadcastPush(['user-1'], payload);

    expect(prisma.userDevice.deleteMany).toHaveBeenCalledTimes(1);
    expect([...devices.keys()]).toEqual(['apns-ok']);
  });

  it('keeps delivering to valid tokens and logs failures with the pruned tokens', async () => {
    seed('fcm-expired', 'android');
    seed('fcm-ok-1', 'android');
    seed('fcm-ok-2', 'android');
    seed('apns-gone', 'ios');
    seed('apns-ok', 'ios');
    const fcm = fakeFcm({ 'fcm-expired': 'messaging/registration-token-not-registered' });
    const apns = fakeApns({ 'apns-gone': 410 });
    const engine = new NotificationEngine({ fcm, apns });

    const result = await engine.broadcastPush(['user-1'], payload);

    expect(result.successCount).toBe(3);
    expect(apns.send).toHaveBeenCalledTimes(2);
    expect(fcm.sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: ['fcm-expired', 'fcm-ok-1', 'fcm-ok-2'] }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'push.delivery.failures',
      expect.objectContaining({ failureCount: 2 }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'push.tokens.pruned',
      expect.objectContaining({ count: 2 }),
    );
  });

  it('does not prune tokens for transient or unrelated errors', async () => {
    seed('fcm-unavailable', 'android');
    seed('apns-bad', 'ios');
    const engine = new NotificationEngine({
      fcm: fakeFcm({ 'fcm-unavailable': 'messaging/server-unavailable' }),
      apns: fakeApns({ 'apns-bad': 400 }),
    });

    const result = await engine.broadcastPush(['user-1'], payload);

    expect(prisma.userDevice.deleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failureCount: 2, prunedTokens: [] });
    expect(devices.size).toBe(2);
  });

  it('does not prune when a whole FCM multicast call fails', async () => {
    seed('fcm-1', 'android');
    const fcm = { sendEachForMulticast: vi.fn().mockRejectedValue(new Error('ETIMEDOUT')) };
    const engine = new NotificationEngine({ fcm });

    const result = await engine.broadcastPush(['user-1'], payload);

    expect(prisma.userDevice.deleteMany).not.toHaveBeenCalled();
    expect(result.failureCount).toBe(1);
  });

  it('does not fail the broadcast when the prune query itself fails', async () => {
    seed('fcm-expired', 'android');
    prisma.userDevice.deleteMany.mockRejectedValueOnce(new Error('db down'));
    const engine = new NotificationEngine({
      fcm: fakeFcm({ 'fcm-expired': 'messaging/registration-token-not-registered' }),
    });

    await expect(engine.broadcastPush(['user-1'], payload)).resolves.toMatchObject({
      failureCount: 1,
      prunedTokens: [],
    });
    expect(logger.error).toHaveBeenCalledWith('push.tokens.pruneFailed', expect.any(Object));
  });

  it('never logs full push tokens', async () => {
    const token = 'fcm-expired-0123456789abcdef';
    seed(token, 'android');
    const engine = new NotificationEngine({
      fcm: fakeFcm({ [token]: 'messaging/registration-token-not-registered' }),
    });

    await engine.broadcastPush(['user-1'], payload);

    const logged = JSON.stringify([...logger.warn.mock.calls, ...logger.info.mock.calls]);
    expect(logged).not.toContain(token);
  });

  it('registerPushToken persists the token for later broadcasts', async () => {
    const engine = new NotificationEngine({ fcm: fakeFcm() });

    await engine.registerPushToken('user-1', 'device-1', 'fcm-new', 'android');
    const result = await engine.broadcastPush(['user-1'], payload);

    expect(prisma.userDevice.upsert).toHaveBeenCalledTimes(1);
    expect(result.successCount).toBe(1);
  });
});
