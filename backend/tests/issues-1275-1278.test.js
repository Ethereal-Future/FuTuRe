import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/client.js', () => ({
  default: {
    setting: { findFirst: vi.fn() },
    pendingMultiSigTx: { findUnique: vi.fn() },
    notificationPreference: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  },
}));
vi.mock('../src/config/env.js', () => ({
  getConfig: () => ({ stellar: { network: 'testnet', serverBaseUrl: 'https://futureremit.app', signingKey: '' } }),
}));
vi.mock('../src/eventSourcing/index.js', () => ({
  eventMonitor: { publishEvent: vi.fn() },
}));
vi.mock('../src/services/stellar.js', () => ({
  getHorizonServer: () => ({ loadAccount: vi.fn() }),
  withHorizonRetry: (operation) => operation(),
}));
vi.mock('../src/notifications/service.js', () => ({ sendNotification: vi.fn() }));
vi.mock('../src/notifications/index.js', () => ({ sendNotification: vi.fn() }));
vi.mock('../src/webhooks/dispatcher.js', () => ({ dispatchEvent: vi.fn() }));
vi.mock('../src/cache/balanceCache.js', () => ({ invalidateBalanceCache: vi.fn() }));
vi.mock('../src/utils/concurrency.js', () => ({ runWithConcurrency: vi.fn() }));

import * as StellarSdk from '@stellar/stellar-sdk';
import { resolveFederationAddress } from '../src/services/federation.js';
import AssetRegistryService from '../src/services/assetRegistry.js';
import { addSignature } from '../src/services/multiSig.js';
import { checkAllUserBalances } from '../src/services/lowBalanceMonitor.js';
import prisma from '../src/db/client.js';

const issuer = StellarSdk.Keypair.random();

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  process.env.STELLAR_FEDERATION_DOMAIN = 'futureremit.app';
});

describe('issues #1275 and #1276: Stellar domain verification infrastructure', () => {
  it('caches a discovered federation endpoint and resolved response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new globalThis.Response('FEDERATION_SERVER="https://anchor.example/federation"'))
      .mockResolvedValueOnce(new globalThis.Response(JSON.stringify({ account_id: issuer.publicKey(), memo_type: 'none' })));
    vi.stubGlobal('fetch', fetchMock);

    const first = await resolveFederationAddress('alice*anchor.example');
    const second = await resolveFederationAddress('alice*anchor.example');

    expect(first.account_id).toBe(issuer.publicKey());
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('opens a destination-specific circuit after three upstream failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('DNS unavailable'));
    vi.stubGlobal('fetch', fetchMock);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(resolveFederationAddress('alice*downstream.example')).rejects.toMatchObject({ status: 503 });
    }
    await expect(resolveFederationAddress('alice*downstream.example')).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('requires reciprocal issuer metadata and a valid detached TOML signature', async () => {
    const service = new AssetRegistryService('https://horizon.example');
    service.server = { loadAccount: vi.fn().mockResolvedValue({ home_domain: 'issuer.example' }) };
    const unsignedToml = `SIGNING_KEY="${issuer.publicKey()}"\n[[CURRENCIES]]\ncode="USDC"\nissuer="${issuer.publicKey()}"`;
    const signature = issuer.sign(Buffer.from(unsignedToml)).toString('base64');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(new globalThis.Response(`${unsignedToml}\nSIGNATURE="${signature}"`))));

    await expect(service.verifyIssuerDomain('USDC', issuer.publicKey())).resolves.toMatchObject({
      verified: true,
      homeDomain: 'issuer.example',
    });

    const spoofedToml = unsignedToml.replace(issuer.publicKey(), StellarSdk.Keypair.random().publicKey());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new globalThis.Response(spoofedToml)));
    await expect(service.verifyIssuerDomain('USDC', issuer.publicKey())).resolves.toMatchObject({ verified: false });
  });
});

describe('issue #1278: private keys never enter addSignature', () => {
  it('rejects the legacy plaintext secret argument before database access', async () => {
    await expect(addSignature('pending-1', issuer.secret())).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_MULTISIG_CONFIG',
    });
  });

  it('requires a client-signed envelope', async () => {
    await expect(addSignature('pending-1', {})).rejects.toThrow('signedXdr is required');
  });
});

describe('issue #1277: bounded low-balance polling', () => {
  it('queries recency-filtered accounts in 100-record keyset pages', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([]);
    await checkAllUserBalances();
    expect(prisma.notificationPreference.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
      orderBy: { id: 'asc' },
      where: expect.objectContaining({
        lowBalanceAlertEnabled: true,
        user: expect.objectContaining({ OR: expect.any(Array) }),
        OR: expect.any(Array),
      }),
    }));
  });
});
