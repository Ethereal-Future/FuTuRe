import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStreams = [];
let inFlight = 0;
let maxInFlight = 0;

vi.mock('../src/db/client.js', () => ({
  default: {
    paymentStream: {
      findMany: vi.fn(() => Promise.resolve(mockStreams.map((s) => ({ ...s })))),
      updateMany: vi.fn(({ where, data }) => {
        const s = mockStreams.find((x) => x.id === where.id);
        if (!s) return Promise.resolve({ count: 0 });
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
  tickStreamPayment: vi.fn(async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 50));
    inFlight -= 1;
    return { success: true, hash: 'h' };
  }),
}));

const { processActiveStreams } = await import('../src/services/streaming.js');
const { tickStreamPayment } = await import('../src/services/streamContract.js');

describe('parallel stream processing (#1368)', () => {
  beforeEach(() => {
    mockStreams.length = 0;
    inFlight = 0;
    maxInFlight = 0;
    vi.clearAllMocks();
  });

  it('processes multiple due streams concurrently (bounded)', async () => {
    for (let i = 0; i < 8; i++) {
      mockStreams.push({
        id: `parallel-${i}`,
        status: 'ACTIVE',
        failureCount: 0,
        lastProcessedAt: new Date(Date.now() - 120_000),
        intervalSeconds: 60,
        rateAmount: 1,
        totalStreamed: 0,
        assetCode: 'XLM',
        escrowContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHLQN',
        contractStreamId: String(i),
        nextAttemptAt: null,
        sender: { publicKey: 'GABC' },
        recipient: { publicKey: 'GXYZ' },
        endTime: null,
      });
    }

    const started = Date.now();
    await processActiveStreams();
    const elapsed = Date.now() - started;

    expect(tickStreamPayment).toHaveBeenCalledTimes(8);
    // With concurrency 5 and 50ms each, 8 streams should finish well under sequential 400ms.
    expect(elapsed).toBeLessThan(350);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(mockStreams.every((s) => s.totalStreamed === 1)).toBe(true);
  });
});
