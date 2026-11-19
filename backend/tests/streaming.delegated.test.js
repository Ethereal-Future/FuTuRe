import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({
  default: {
    user: {
      upsert: vi.fn(({ where }) =>
        Promise.resolve({ id: 'u1', publicKey: where.publicKey }),
      ),
    },
    paymentStream: {
      count: vi.fn(() => Promise.resolve(0)),
      create: vi.fn(({ data }) =>
        Promise.resolve({
          id: 'stream-delegated-1',
          ...data,
          totalStreamed: 0,
          lastProcessedAt: new Date(),
        }),
      ),
    },
  },
}));

vi.mock('../src/eventSourcing/index.js', () => ({
  eventMonitor: { publishEvent: vi.fn(() => Promise.resolve({})) },
}));

vi.mock('../src/cache/redis.js', () => ({
  createRedisBackend: () => ({
    connect: async () => {},
    setNX: async () => true,
    delete: async () => {},
  }),
}));

vi.mock('../src/services/streamContract.js', () => ({
  createDelegatedStreamEscrow: vi.fn(async ({ escrowContractId, contractStreamId }) => ({
    escrowContractId,
    contractStreamId: String(contractStreamId),
    delegated: true,
  })),
  tickStreamPayment: vi.fn(),
}));

const { createStream } = await import('../src/services/streaming.js');
const prisma = (await import('../src/db/client.js')).default;

describe('delegated streaming (#1370)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects custodial senderSecret', async () => {
    await expect(
      createStream({
        senderPublicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
        recipientPublicKey: 'GXYZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST',
        senderSecret: 'SSECRET',
        rateAmount: 1,
        escrowContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHLQN',
        contractStreamId: '1',
      }),
    ).rejects.toMatchObject({ code: 'CUSTODIAL_SECRET_REJECTED' });
  });

  it('stores escrow refs and never persists senderSecret', async () => {
    const stream = await createStream({
      senderPublicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW',
      recipientPublicKey: 'GXYZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST',
      rateAmount: 1,
      intervalSeconds: 60,
      escrowContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHLQN',
      contractStreamId: '7',
    });

    expect(stream.senderSecret).toBeNull();
    expect(stream.escrowContractId).toMatch(/^C/);
    expect(stream.contractStreamId).toBe('7');
    const createArg = prisma.paymentStream.create.mock.calls[0][0].data;
    expect(createArg.senderSecret).toBeNull();
    expect(createArg).not.toHaveProperty('senderSecret', expect.stringMatching(/^S/));
  });
});
