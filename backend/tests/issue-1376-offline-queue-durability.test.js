import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as StellarSDK from '@stellar/stellar-sdk';

const dbRows = [];

vi.mock('../src/db/client.js', () => ({
  default: {
    mobileOfflineQueueItem: {
      create: vi.fn(({ data }) => {
        if (!dbRows.some((r) => r.id === data.id)) {
          dbRows.push({ result: null, error: null, processedAt: null, ...data });
        }
        return Promise.resolve(data);
      }),
      findMany: vi.fn(({ where }) =>
        Promise.resolve(
          dbRows.filter(
            (r) => r.userId === where.userId && r.status === where.status,
          ),
        ),
      ),
      update: vi.fn(({ where, data }) => {
        const row = dbRows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
      deleteMany: vi.fn(({ where }) => {
        for (let i = dbRows.length - 1; i >= 0; i--) {
          if (dbRows[i].userId === where.userId && dbRows[i].status !== 'pending') {
            dbRows.splice(i, 1);
          }
        }
        return Promise.resolve({ count: 1 });
      }),
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

const { default: offlineQueue } = await import('../src/mobile/offlineQueue.js');
const { horizonServer } = await import('../src/config/stellar.js');
const StellarService = await import('../src/services/stellar.js');

describe('offline queue durability across instances (#1376)', () => {
  const userId = 'user-durable';

  beforeEach(() => {
    dbRows.length = 0;
    offlineQueue.queues.clear();
    offlineQueue.persistenceEnabled = true;
    vi.clearAllMocks();
  });

  it('persists enqueued items to the database', async () => {
    const item = offlineQueue.enqueue(userId, { signedXdr: 'AAAA' });
    await offlineQueue._persistEnqueue(item);

    expect(dbRows).toHaveLength(1);
    expect(dbRows[0].id).toBe(item.id);
    expect(dbRows[0].status).toBe('pending');
  });

  it('lets a different instance hydrate and flush items enqueued elsewhere', async () => {
    const source = StellarSDK.Keypair.random();
    const dest = StellarSDK.Keypair.random();

    const item = offlineQueue.enqueue(userId, {
      sourceSecret: source.secret(),
      destination: dest.publicKey(),
      amount: '3',
      assetCode: 'XLM',
    });
    await offlineQueue._persistEnqueue(item);

    // Simulate a redeploy / different ECS task: volatile memory is gone.
    offlineQueue.queues.clear();
    expect(offlineQueue.getQueue(userId)).toHaveLength(0);

    horizonServer.loadAccount.mockResolvedValue({
      sequenceNumber: () => '5',
      accountId: source.publicKey(),
    });
    StellarService.sendPayment.mockResolvedValue({ success: true, hash: 'durable-hash' });

    const outcome = await offlineQueue.flushQueue(userId);

    expect(outcome.processed).toBe(1);
    expect(outcome.results[0].status).toBe('success');
    expect(StellarService.sendPayment).toHaveBeenCalledOnce();
  });
});
