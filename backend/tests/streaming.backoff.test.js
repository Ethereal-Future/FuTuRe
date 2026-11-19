import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStreams = [];

vi.mock('../src/db/client.js', () => ({
  default: {
    paymentStream: {
      findMany: vi.fn(({ where } = {}) => {
        const now = new Date();
        return Promise.resolve(
          mockStreams.filter((s) => {
            if (where?.status && s.status !== where.status) return false;
            if (s.nextAttemptAt && s.nextAttemptAt > now) return false;
            return true;
          }).map((s) => ({ ...s })),
        );
      }),
      updateMany: vi.fn(({ where, data }) => {
        const s = mockStreams.find((x) => x.id === where.id);
        if (!s) return Promise.resolve({ count: 0 });
        Object.assign(s, data);
        return Promise.resolve({ count: 1 });
      }),
      update: vi.fn(({ where, data }) => {
        const s = mockStreams.find((x) => x.id === where.id);
        if (!s) return Promise.reject(new Error('Not found'));
        if (data.failureCount?.increment) {
          s.failureCount = (s.failureCount || 0) + data.failureCount.increment;
          delete data.failureCount;
        }
        Object.assign(s, data);
        return Promise.resolve({ ...s });
      }),
    },
    streamFailure: {
      create: vi.fn(() => Promise.resolve({})),
    },
  },
}));

vi.mock('../src/eventSourcing/index.js', () => ({
  eventMonitor: { publishEvent: vi.fn(() => Promise.resolve({})) },
}));

vi.mock('../src/notifications/webPush.js', () => ({
  getSubscriptionByPublicKey: vi.fn(() => null),
  sendWebPush: vi.fn(),
}));

vi.mock('../src/cache/redis.js', () => ({
  createRedisBackend: () => ({
    connect: async () => {},
    setNX: async () => true,
    delete: async () => {},
  }),
}));

vi.mock('../src/services/streamContract.js', () => ({
  createDelegatedStreamEscrow: vi.fn(),
  tickStreamPayment: vi.fn(),
}));

const { processActiveStreams } = await import('../src/services/streaming.js');
const { tickStreamPayment } = await import('../src/services/streamContract.js');

describe('stream failure backoff (#1369)', () => {
  beforeEach(() => {
    mockStreams.length = 0;
    vi.clearAllMocks();
  });

  it('sets nextAttemptAt on failure so the next worker tick does not re-fire immediately', async () => {
    tickStreamPayment.mockRejectedValue(new Error('horizon timeout'));

    const stream = {
      id: 'backoff-1',
      status: 'ACTIVE',
      failureCount: 0,
      lastProcessedAt: new Date(Date.now() - 120_000),
      intervalSeconds: 60,
      rateAmount: 1,
      assetCode: 'XLM',
      escrowContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHLQN',
      contractStreamId: '1',
      nextAttemptAt: null,
      sender: { publicKey: 'GABC' },
      recipient: { publicKey: 'GXYZ' },
      endTime: null,
    };
    mockStreams.push(stream);

    await processActiveStreams();

    expect(stream.failureCount).toBe(1);
    expect(stream.nextAttemptAt).toBeInstanceOf(Date);
    expect(stream.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Immediate second tick must skip due to nextAttemptAt
    const before = stream.failureCount;
    await processActiveStreams();
    expect(stream.failureCount).toBe(before);
  });
});
