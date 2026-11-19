import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({
  default: {
    user: {
      upsert: vi.fn(({ where }) => Promise.resolve({ id: 'u1', publicKey: where.publicKey })),
    },
    paymentStream: {
      count: vi.fn(() => Promise.resolve(0)),
      create: vi.fn(({ data }) => Promise.resolve({ id: 'stream-1', ...data, totalStreamed: 0 })),
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
  })),
  tickStreamPayment: vi.fn(),
}));

const loadAccount = vi.fn();
vi.mock('../src/config/stellar.js', () => ({
  horizonServer: { loadAccount: (...args) => loadAccount(...args) },
}));

const { createStream } = await import('../src/services/streaming.js');

const SENDER = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW';
const RECIPIENT = 'GXYZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRST';
const ESCROW = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHLQN';

describe('createStream pre-flight validation (#1374)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when the sender holds no balance for the non-native asset', async () => {
    loadAccount
      .mockResolvedValueOnce({ balances: [{ asset_code: 'USDC', balance: '0.0000000' }] })
      .mockResolvedValueOnce({ balances: [{ asset_code: 'USDC', balance: '0.0000000', limit: '1000' }] });

    await expect(
      createStream({
        senderPublicKey: SENDER,
        recipientPublicKey: RECIPIENT,
        assetCode: 'USDC',
        rateAmount: 5,
        escrowContractId: ESCROW,
        contractStreamId: '1',
      }),
    ).rejects.toMatchObject({ code: 'STREAM_SENDER_BALANCE_INSUFFICIENT' });
  });

  it('rejects when the recipient has no trustline for the non-native asset', async () => {
    loadAccount
      .mockResolvedValueOnce({ balances: [{ asset_code: 'USDC', balance: '100.0000000', limit: '1000' }] })
      .mockResolvedValueOnce({ balances: [{ asset_type: 'native', balance: '10' }] });

    await expect(
      createStream({
        senderPublicKey: SENDER,
        recipientPublicKey: RECIPIENT,
        assetCode: 'USDC',
        rateAmount: 5,
        escrowContractId: ESCROW,
        contractStreamId: '1',
      }),
    ).rejects.toMatchObject({ code: 'STREAM_RECIPIENT_TRUSTLINE_MISSING' });
  });

  it('creates the stream when sender balance and recipient trustline are valid', async () => {
    loadAccount
      .mockResolvedValueOnce({ balances: [{ asset_code: 'USDC', balance: '100.0000000', limit: '1000' }] })
      .mockResolvedValueOnce({ balances: [{ asset_code: 'USDC', balance: '0.0000000', limit: '1000' }] });

    const stream = await createStream({
      senderPublicKey: SENDER,
      recipientPublicKey: RECIPIENT,
      assetCode: 'USDC',
      rateAmount: 5,
      escrowContractId: ESCROW,
      contractStreamId: '1',
    });

    expect(stream.status).toBe('ACTIVE');
    expect(loadAccount).toHaveBeenCalledTimes(2);
  });

  it('skips Horizon checks for native XLM streams', async () => {
    const stream = await createStream({
      senderPublicKey: SENDER,
      recipientPublicKey: RECIPIENT,
      assetCode: 'XLM',
      rateAmount: 5,
      escrowContractId: ESCROW,
      contractStreamId: '1',
    });

    expect(stream.status).toBe('ACTIVE');
    expect(loadAccount).not.toHaveBeenCalled();
  });
});
