import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as StellarSDK from '@stellar/stellar-sdk';

vi.mock('../src/db/client.js', () => ({
  default: {
    mobileOfflineQueueItem: {
      create: vi.fn(() => Promise.resolve({})),
      findMany: vi.fn(() => Promise.resolve([])),
      update: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
  },
}));

vi.mock('../src/cache/redis.js', () => ({
  createRedisBackend: () => ({
    connect: async () => {},
    set: async () => {},
    get: async () => null,
    delete: async () => {},
  }),
}));

vi.mock('../src/config/stellar.js', () => ({
  horizonServer: { loadAccount: vi.fn(), submitTransaction: vi.fn() },
  networkPassphrase: StellarSDK.Networks.TESTNET,
}));

vi.mock('../src/services/stellar.js', () => ({ sendPayment: vi.fn() }));

const { default: offlineQueue, MAX_OFFLINE_QUEUE_ITEMS, MAX_PAYLOAD_BYTES } =
  await import('../src/mobile/offlineQueue.js');

describe('offline queue resource limits (#1378)', () => {
  const userId = 'user-limits';

  beforeEach(() => {
    offlineQueue.queues.clear();
    offlineQueue.persistenceEnabled = false;
    vi.clearAllMocks();
  });

  it('caps a user at exactly MAX_OFFLINE_QUEUE_ITEMS (50) pending items', () => {
    for (let i = 0; i < MAX_OFFLINE_QUEUE_ITEMS; i++) {
      offlineQueue.enqueue(userId, { signedXdr: `xdr-${i}` });
    }

    expect(offlineQueue.getQueue(userId)).toHaveLength(MAX_OFFLINE_QUEUE_ITEMS);
    expect(() => offlineQueue.enqueue(userId, { signedXdr: 'overflow' })).toThrow(
      /Offline queue limit reached \(max 50 items\)/,
    );
  });

  it('rejects payloads larger than MAX_PAYLOAD_BYTES', () => {
    const big = 'a'.repeat(MAX_PAYLOAD_BYTES + 1);
    try {
      offlineQueue.enqueue(userId, { signedXdr: big });
      throw new Error('expected rejection');
    } catch (err) {
      expect(err.code).toBe('OFFLINE_QUEUE_PAYLOAD_TOO_LARGE');
    }
    expect(offlineQueue.getQueue(userId)).toHaveLength(0);
  });

  it('accepts a payload within the byte budget', () => {
    expect(() =>
      offlineQueue.enqueue(userId, { signedXdr: 'a'.repeat(100) }),
    ).not.toThrow();
  });
});
