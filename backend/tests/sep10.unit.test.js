import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mockSign = vi.hoisted(() => vi.fn());
const mockFromXdrTx = vi.hoisted(() => ({
  source: 'GSERVERKEY',
  sequence: '0',
  timeBounds: { maxTime: `${Math.floor(Date.now() / 1000) + 600}` },
  operations: [{ type: 'manageData', name: 'anchor.example auth', source: 'GSENDERKEY' }],
  sign: mockSign,
  toXDR: vi.fn(() => 'signed-challenge-xdr'),
}));

vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromSecret: vi.fn(() => ({
      publicKey: () => 'GSENDERKEY',
    })),
  },
  TransactionBuilder: {
    fromXDR: vi.fn(() => mockFromXdrTx),
  },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015',
  },
}));

vi.mock('../src/utils/ssrfValidator.js', () => ({
  validatePublicDomain: vi.fn((domain) =>
    Promise.resolve({ hostname: domain, dnsPin: { hostname: domain, addresses: ['1.1.1.1'] } }),
  ),
  validatePublicHttpsUrl: vi.fn((url) =>
    Promise.resolve({
      parsed: new URL(String(url)),
      normalizedUrl: String(url),
      dnsPin: { hostname: 'anchor.example', addresses: ['1.1.1.1'] },
    }),
  ),
  assertDnsPin: vi.fn(() => Promise.resolve()),
}));

describe('sep10 authenticateWithAnchor', () => {
  let fetchMock;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.SEP10_SENDER_SECRET = 'S'.repeat(56);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SEP10_SENDER_SECRET;
  });

  it('requests challenge, signs it, exchanges JWT, and returns token', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: () =>
          Promise.resolve(
            'WEB_AUTH_ENDPOINT="https://anchor.example/auth"\nSIGNING_KEY="GSERVERKEY"\n',
          ),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transaction: 'challenge-xdr' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            token: `aaa.${Buffer.from(
              JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
            ).toString('base64')}.bbb`,
          }),
      });

    const { authenticateWithAnchor } = await import('../src/services/sep10.js');
    const token = await authenticateWithAnchor('https://anchor.example/sep31');

    expect(token).toContain('.');
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
