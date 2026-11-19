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

const { processActiveStreams, STREAM_MAX_CONSECUTIVE_FAILURES } = await import('../src/services/streaming.js');
const { tickStreamPayment } = await import('../src/services/streamContract.js');

function makeStream(overrides = {}) {
  return {
    id: 'fail-threshold-1',
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
    ...overrides,
  };
}

describe('stream failure threshold (#1367)', () => {
  beforeEach(() => {
    mockStreams.length = 0;
    vi.clearAllMocks();
    tickStreamPayment.mockRejectedValue(new Error('horizon timeout'));
  });

  it('defaults STREAM_MAX_CONSECUTIVE_FAILURES to 5', () => {
    expect(STREAM_MAX_CONSECUTIVE_FAILURES).toBe(5);
  });

  it('remains ACTIVE after 3 and 4 consecutive failures', async () => {
    const stream = makeStream();
    mockStreams.push(stream);

    for (let i = 0; i < 4; i++) {
      stream.lastProcessedAt = new Date(Date.now() - 120_000);
      stream.nextAttemptAt = null;
      await processActiveStreams();
    }

    expect(stream.failureCount).toBe(4);
    expect(stream.status).toBe('ACTIVE');
  });

  it('transitions to FAILED only at the 5th consecutive failure', async () => {
    const stream = makeStream({ failureCount: 4 });
    mockStreams.push(stream);

    await processActiveStreams();

    expect(stream.failureCount).toBe(5);
    expect(stream.status).toBe('FAILED');
  });
});
