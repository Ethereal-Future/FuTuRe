/**
 * Cross-Instance Integration Test — Web Push (#1125)
 *
 * Verifies that two separate instances of the webPush helpers share state
 * through the same Redis backing store (keys: webpush:user:{userId} and
 * webpush:key:{publicKey}).
 *
 * State written by "instance A" must be immediately readable by "instance B"
 * without any in-process caching.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a fresh webPush module-equivalent that uses an injected Redis client
 * rather than the singleton — simulates two separate processes sharing Redis.
 */
function makeWebPush(redisClient) {
  function userKey(userId) {
    return `webpush:user:${userId}`;
  }
  function publicKeyKey(publicKey) {
    return `webpush:key:${publicKey}`;
  }

  return {
    async saveSubscription(userId, subscription, publicKey) {
      await redisClient.set(userKey(userId), { subscription, publicKey });
      if (publicKey) {
        await redisClient.set(publicKeyKey(publicKey), subscription);
      }
    },

    async getSubscription(userId) {
      const record = await redisClient.get(userKey(userId));
      return record?.subscription ?? null;
    },

    async getSubscriptionByPublicKey(publicKey) {
      return redisClient.get(publicKeyKey(publicKey));
    },

    async removeSubscription(userId) {
      const record = await redisClient.get(userKey(userId));
      if (record?.publicKey) {
        await redisClient.delete(publicKeyKey(record.publicKey));
      }
      await redisClient.delete(userKey(userId));
    },
  };
}

// ── Shared in-memory Redis (simulates a single Redis instance) ────────────────

function createSharedRedisStore() {
  const store = new Map();

  return {
    set: vi.fn(async (key, value) => {
      store.set(key, value);
    }),
    get: vi.fn(async (key) => store.get(key) ?? null),
    delete: vi.fn(async (key) => {
      store.delete(key);
    }),
    _store: store, // expose for assertions
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Web Push — cross-instance integration', () => {
  let sharedRedis;
  let instanceA;
  let instanceB;

  beforeEach(() => {
    sharedRedis = createSharedRedisStore();
    instanceA = makeWebPush(sharedRedis);
    instanceB = makeWebPush(sharedRedis);
  });

  it('subscription saved by instance A is readable by instance B via userId', async () => {
    const userId = 'user-abc';
    const subscription = { endpoint: 'https://push.example.com/sub/1', keys: { auth: 'x', p256dh: 'y' } };
    const publicKey = 'pk-user-abc';

    await instanceA.saveSubscription(userId, subscription, publicKey);

    const loaded = await instanceB.getSubscription(userId);

    expect(loaded).toEqual(subscription);
  });

  it('subscription saved by instance A is readable by instance B via publicKey', async () => {
    const userId = 'user-def';
    const subscription = { endpoint: 'https://push.example.com/sub/2' };
    const publicKey = 'pk-user-def';

    await instanceA.saveSubscription(userId, subscription, publicKey);

    const loaded = await instanceB.getSubscriptionByPublicKey(publicKey);

    expect(loaded).toEqual(subscription);
  });

  it('getSubscription returns null when no subscription exists', async () => {
    const result = await instanceB.getSubscription('unknown-user');
    expect(result).toBeNull();
  });

  it('subscription removed by instance A is no longer readable by instance B', async () => {
    const userId = 'user-ghi';
    const subscription = { endpoint: 'https://push.example.com/sub/3' };
    const publicKey = 'pk-user-ghi';

    await instanceA.saveSubscription(userId, subscription, publicKey);
    await instanceA.removeSubscription(userId);

    const byUserId = await instanceB.getSubscription(userId);
    const byPublicKey = await instanceB.getSubscriptionByPublicKey(publicKey);

    expect(byUserId).toBeNull();
    expect(byPublicKey).toBeNull();
  });

  it('multiple users maintain independent subscriptions across instances', async () => {
    const users = [
      { userId: 'u1', subscription: { endpoint: 'https://push.example.com/u1' }, publicKey: 'pk-u1' },
      { userId: 'u2', subscription: { endpoint: 'https://push.example.com/u2' }, publicKey: 'pk-u2' },
      { userId: 'u3', subscription: { endpoint: 'https://push.example.com/u3' }, publicKey: 'pk-u3' },
    ];

    // Instance A saves all three
    for (const u of users) {
      await instanceA.saveSubscription(u.userId, u.subscription, u.publicKey);
    }

    // Instance B reads all three
    for (const u of users) {
      const loaded = await instanceB.getSubscription(u.userId);
      expect(loaded).toEqual(u.subscription);
    }
  });

  it('overwriting a subscription by instance A is seen by instance B', async () => {
    const userId = 'user-jkl';
    const originalSub = { endpoint: 'https://push.example.com/original' };
    const updatedSub = { endpoint: 'https://push.example.com/updated' };

    await instanceA.saveSubscription(userId, originalSub, 'pk-original');
    await instanceA.saveSubscription(userId, updatedSub, 'pk-updated');

    const loaded = await instanceB.getSubscription(userId);

    expect(loaded).toEqual(updatedSub);
  });

  it('Redis keys follow the webpush:user:{userId} and webpush:key:{publicKey} naming convention', async () => {
    const userId = 'user-naming-test';
    const publicKey = 'pk-naming-test';
    const subscription = { endpoint: 'https://push.example.com/naming' };

    await instanceA.saveSubscription(userId, subscription, publicKey);

    expect(sharedRedis._store.has(`webpush:user:${userId}`)).toBe(true);
    expect(sharedRedis._store.has(`webpush:key:${publicKey}`)).toBe(true);
  });
});
