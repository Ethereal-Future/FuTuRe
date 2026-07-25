import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as StellarSDK from '@stellar/stellar-sdk';

vi.mock('@stellar/stellar-sdk', () => ({
  Keypair: { random: vi.fn() },
  Horizon: { Server: vi.fn() },
  Asset: Object.assign(vi.fn(), { native: vi.fn() }),
  TransactionBuilder: vi.fn(),
  Operation: { payment: vi.fn(), changeTrust: vi.fn() },
  Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
  BASE_FEE: '100',
}));

vi.mock('../src/eventSourcing/index.js', () => ({
  eventMonitor: { publishEvent: vi.fn(() => Promise.resolve()), initialize: vi.fn() },
}));

vi.mock('../src/config/env.js', () => ({
  getConfig: vi.fn(() => ({ stellar: { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' } })),
}));

vi.mock('../src/config/logger.js', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/db/client.js', () => ({
  default: {
    user: { upsert: vi.fn(() => Promise.resolve({ id: 'user-1' })) },
    $transaction: vi.fn((fn) => fn({ user: { upsert: vi.fn(() => Promise.resolve({ id: 'user-1' })) } })),
  },
}));

describe('createAccount – Friendbot failure path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    StellarSDK.Keypair.random.mockReturnValue({
      publicKey: vi.fn(() => 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJBBX7IXLMQVVXTNQRYUOP7H'),
      secret: vi.fn(() => 'SBZVMB74Z76QZ3ZVU4Z7YVCC5L7GXWCF7IXLMQVVXTNQRYUOP7HGHJH'),
    });
    StellarSDK.Horizon.Server.mockImplementation(() => ({}));
  });

  it('throws a descriptive error when Friendbot returns a non-ok response', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 400, statusText: 'Bad Request' })
    );

    const { createAccount } = await import('../src/services/stellar.js');

    await expect(createAccount()).rejects.toThrow(/friendbot funding failed/i);
  });

  it('includes the HTTP status in the error message', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 429, statusText: 'Too Many Requests' })
    );

    const { createAccount } = await import('../src/services/stellar.js');

    await expect(createAccount()).rejects.toThrow('429');
  });

  it('does not return a partially-created account on Friendbot failure', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, statusText: 'Internal Server Error' })
    );

    const { createAccount } = await import('../src/services/stellar.js');

    await expect(createAccount()).rejects.toThrow();
  });
});
