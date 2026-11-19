import { describe, it, expect, vi, beforeEach } from 'vitest';

const publishEvent = vi.fn(() => Promise.resolve({}));

vi.mock('../src/db/client.js', () => {
  const state = { stream: null };
  return {
    default: {
      paymentStream: {
        findUnique: vi.fn(() => Promise.resolve(state.stream)),
        update: vi.fn(({ data }) => {
          const increment = data.totalStreamed?.increment ?? 0;
          const { totalStreamed, ...rest } = data;
          state.stream = {
            ...state.stream,
            ...rest,
            totalStreamed: (state.stream.totalStreamed ?? 0) + increment,
          };
          return Promise.resolve(state.stream);
        }),
      },
      __setStream: (s) => {
        state.stream = s;
      },
    },
  };
});

vi.mock('../src/eventSourcing/index.js', () => ({
  eventMonitor: { publishEvent: (...a) => publishEvent(...a) },
}));

vi.mock('../src/cache/redis.js', () => ({
  createRedisBackend: () => ({
    connect: async () => {},
    setNX: async () => true,
    delete: async () => {},
  }),
}));

const tickStreamPayment = vi.fn(() => Promise.resolve({ success: true, hash: 'settle-hash' }));
vi.mock('../src/services/streamContract.js', () => ({
  createDelegatedStreamEscrow: vi.fn(),
  tickStreamPayment: (...a) => tickStreamPayment(...a),
}));

vi.mock('../src/config/stellar.js', () => ({
  horizonServer: { loadAccount: vi.fn() },
}));

const { cancelStream } = await import('../src/services/streaming.js');
const prisma = (await import('../src/db/client.js')).default;

const SENDER = { publicKey: 'GSENDERPUBLICKEY' };
const ESCROW = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHLQN';

function makeStream(overrides = {}) {
  return {
    id: 'stream-1',
    senderId: 'u1',
    sender: SENDER,
    assetCode: 'USDC',
    rateAmount: 100,
    intervalSeconds: 86400,
    lastProcessedAt: new Date(Date.now() - 23 * 3600 * 1000),
    totalStreamed: 0,
    status: 'ACTIVE',
    escrowContractId: ESCROW,
    contractStreamId: '1',
    ...overrides,
  };
}

describe('cancelStream prorated settlement (#1375)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tickStreamPayment.mockResolvedValue({ success: true, hash: 'settle-hash' });
  });

  it('executes a final prorated payment for elapsed time when settleProrated is true', async () => {
    prisma.__setStream(makeStream());

    const stream = await cancelStream('stream-1', { settleProrated: true });

    expect(stream.status).toBe('CANCELLED');
    expect(tickStreamPayment).toHaveBeenCalledWith(ESCROW, '1');
    // 23/24 of 100 ≈ 95.8333333 (floored to 7dp)
    expect(stream.totalStreamed).toBeCloseTo(95.8333333, 6);

    const settled = publishEvent.mock.calls.find(([, e]) => e.type === 'StreamSettled');
    expect(settled).toBeTruthy();
    expect(settled[1].data.amount).toBeCloseTo(95.8333333, 6);
  });

  it('does not settle when settleProrated is not requested', async () => {
    prisma.__setStream(makeStream());

    const stream = await cancelStream('stream-1');

    expect(stream.status).toBe('CANCELLED');
    expect(tickStreamPayment).not.toHaveBeenCalled();
    expect(stream.totalStreamed).toBe(0);
    expect(publishEvent.mock.calls.find(([, e]) => e.type === 'StreamSettled')).toBeFalsy();
  });

  it('skips settlement for negligible elapsed fractions', async () => {
    prisma.__setStream(makeStream({ lastProcessedAt: new Date() }));

    const stream = await cancelStream('stream-1', { settleProrated: true });

    expect(tickStreamPayment).not.toHaveBeenCalled();
    expect(stream.totalStreamed).toBe(0);
  });
});
