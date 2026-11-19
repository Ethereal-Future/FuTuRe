import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStreams = [];

vi.mock('../src/db/client.js', () => ({
  default: {
    paymentStream: {
      findMany: vi.fn(() => Promise.resolve(mockStreams.map((s) => ({ ...s })))),
      updateMany: vi.fn(({ where, data }) => {
        const s = mockStreams.find((x) => x.id === where.id);
        if (!s) return Promise.resolve({ count: 0 });
        if (where.lastProcessedAt !== undefined &&
            String(s.lastProcessedAt) !== String(where.lastProcessedAt)) {
          return Promise.resolve({ count: 0 });
        }
        Object.assign(s, data);
        return Promise.resolve({ count: 1 });
      }),
      update: vi.fn(({ where, data }) => {
        const s = mockStreams.find((x) => x.id === where.id);
        if (!s) return Promise.reject(new Error('Not found'));
        if (data.totalStreamed?.increment) {
          s.totalStreamed = (s.totalStreamed || 0) + data.totalStreamed.increment;
          delete data.totalStreamed;
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
  // Simulate 5–15ms Horizon latency per payment
  tickStreamPayment: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { success: true, hash: 'h' };
  }),
}));

const { processActiveStreams, nextScheduledProcessedAt } = await import('../src/services/streaming.js');

describe('payment stream schedule drift (#1371)', () => {
  beforeEach(() => {
    mockStreams.length = 0;
    vi.clearAllMocks();
  });

  it('advances lastProcessedAt by exact intervalSeconds (not wall clock)', () => {
    const base = new Date('2026-01-01T12:00:00.000Z');
    const stream = { lastProcessedAt: base, intervalSeconds: 60 };
    expect(nextScheduledProcessedAt(stream).toISOString()).toBe('2026-01-01T12:01:00.000Z');
  });

  it('accumulates zero schedule drift over 50 simulated intervals', async () => {
    const intervalSeconds = 60;
    const origin = new Date('2026-01-01T00:00:00.000Z');
    const stream = {
      id: 'drift-1',
      status: 'ACTIVE',
      failureCount: 0,
      lastProcessedAt: origin,
      intervalSeconds,
      rateAmount: 1,
      totalStreamed: 0,
      assetCode: 'XLM',
      escrowContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHLQN',
      contractStreamId: '1',
      nextAttemptAt: null,
      sender: { publicKey: 'GABC' },
      recipient: { publicKey: 'GXYZ' },
      endTime: null,
    };
    mockStreams.push(stream);

    const intervals = 50;
    for (let i = 0; i < intervals; i++) {
      // Simulate worker waking slightly after the due time (execution jitter)
      const fakeNow = new Date(origin.getTime() + (i + 1) * intervalSeconds * 1000 + 4_000);
      vi.setSystemTime(fakeNow);
      await processActiveStreams();
    }
    vi.useRealTimers();

    const expected = new Date(origin.getTime() + intervals * intervalSeconds * 1000);
    expect(stream.lastProcessedAt.getTime()).toBe(expected.getTime());
    expect(stream.totalStreamed).toBe(intervals);
    // Drift vs fixed schedule must be exactly zero
    const driftMs = stream.lastProcessedAt.getTime() - expected.getTime();
    expect(driftMs).toBe(0);
  });
});
