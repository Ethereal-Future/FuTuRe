/**
 * Tests for issues #953, #954, #955, #956:
 *  - #953 stellarErrors.js — missing permanent error codes, unmapped-code default
 *  - #954 federation.js stellar.toml — config-layer sourcing, ACCOUNTS population
 *  - #955 SEP-0031 cross-border direct payment (sending-anchor client + route)
 *  - #956 Soroban RPC (contract.js) — retry, timeout, centralized config
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// #953 — stellarErrors.js
// ─────────────────────────────────────────────────────────────────────────────

describe('#953 stellarErrors.js', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('maps op_low_reserve, op_no_issuer, and op_already_exists as non-retryable', async () => {
    const { getStellarErrorInfo } = await import('../src/utils/stellarErrors.js');
    for (const code of ['op_low_reserve', 'op_no_issuer', 'op_already_exists']) {
      const info = getStellarErrorInfo(code);
      expect(info.retryable).toBe(false);
      expect(typeof info.userMessage).toBe('string');
      expect(info.userMessage.length).toBeGreaterThan(0);
    }
  });

  it('defaults an unmapped code to non-retryable with a support-facing message', async () => {
    const { getStellarErrorInfo } = await import('../src/utils/stellarErrors.js');
    const info = getStellarErrorInfo('op_some_future_code_not_yet_mapped');
    expect(info.retryable).toBe(false);
    expect(info.userMessage).toMatch(/contact support/i);
  });

  it('logs a warning when an unmapped code is encountered', async () => {
    vi.doMock('../src/config/logger.js', () => ({
      default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
      withContext: vi.fn(),
    }));
    const logger = (await import('../src/config/logger.js')).default;
    const { getStellarErrorInfo } = await import('../src/utils/stellarErrors.js');

    getStellarErrorInfo('totally_unknown_code');

    expect(logger.warn).toHaveBeenCalledWith(
      'stellarErrors.unmappedCode',
      expect.objectContaining({ errorCode: 'totally_unknown_code' }),
    );
  });

  it('still returns known mapped codes unchanged (e.g. op_underfunded)', async () => {
    const { getStellarErrorInfo } = await import('../src/utils/stellarErrors.js');
    const info = getStellarErrorInfo('op_underfunded');
    expect(info.retryable).toBe(false);
    expect(info.userMessage).toMatch(/balance was too low/i);
  });

  it('leaves transient/retryable codes (tx_failed, rate_limit) retryable', async () => {
    const { getStellarErrorInfo } = await import('../src/utils/stellarErrors.js');
    expect(getStellarErrorInfo('tx_failed').retryable).toBe(true);
    expect(getStellarErrorInfo('rate_limit').retryable).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #954 — federation.js stellar.toml / env.js config sourcing
// ─────────────────────────────────────────────────────────────────────────────

const mockKeypairFromSecret = vi.hoisted(() => vi.fn());

vi.mock('@stellar/stellar-sdk', async () => {
  const actualMock = await import('./helpers/sorobanSdkMock.js');
  return actualMock.buildStellarSdkMock({ keypairFromSecret: mockKeypairFromSecret });
});

vi.mock('../src/db/client.js', () => ({
  default: {
    setting: { findFirst: vi.fn(), upsert: vi.fn() },
    user: { upsert: vi.fn() },
    sep31Transaction: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

describe('#954 services/federation.js — buildStellarToml', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.STELLAR_FEDERATION_DOMAIN = 'futureremit.app';
    delete process.env.PLATFORM_FEE_ACCOUNT_SECRET;
  });

  it('sources FEDERATION_SERVER/SIGNING_KEY/NETWORK_PASSPHRASE/TRANSFER_SERVER from getConfig(), not process.env', async () => {
    vi.doMock('../src/config/env.js', () => ({
      getConfig: () => ({
        stellar: {
          network: 'testnet',
          signingKey: 'GSIGNINGKEYFROMCONFIG',
          serverBaseUrl: 'https://api.futureremit.app',
        },
      }),
    }));
    // Raw process.env values that must NOT leak into the output
    process.env.STELLAR_SIGNING_KEY = 'GWRONGENVVALUE';
    process.env.SERVER_BASE_URL = 'http://wrong-env-value';
    process.env.STELLAR_NETWORK = 'mainnet';

    const { buildStellarToml } = await import('../src/services/federation.js');
    const toml = buildStellarToml();

    expect(toml).toContain('FEDERATION_SERVER="https://api.futureremit.app/api/v1/stellar/federation"');
    expect(toml).toContain('SIGNING_KEY="GSIGNINGKEYFROMCONFIG"');
    expect(toml).toContain('NETWORK_PASSPHRASE="Test SDF Network ; September 2015"');
    expect(toml).toContain('TRANSFER_SERVER="https://api.futureremit.app/api/v1/stellar"');
    expect(toml).not.toContain('GWRONGENVVALUE');
    expect(toml).not.toContain('wrong-env-value');

    delete process.env.STELLAR_SIGNING_KEY;
    delete process.env.SERVER_BASE_URL;
    delete process.env.STELLAR_NETWORK;
  });

  it('advertises DIRECT_PAYMENT_SERVER for SEP-0031 discovery', async () => {
    vi.doMock('../src/config/env.js', () => ({
      getConfig: () => ({
        stellar: { network: 'testnet', signingKey: 'GKEY', serverBaseUrl: 'http://localhost:3001' },
      }),
    }));
    const { buildStellarToml } = await import('../src/services/federation.js');
    expect(buildStellarToml()).toContain('DIRECT_PAYMENT_SERVER="http://localhost:3001/api/v1/stellar/sep31"');
  });

  it('uses the public network passphrase on mainnet', async () => {
    vi.doMock('../src/config/env.js', () => ({
      getConfig: () => ({
        stellar: { network: 'mainnet', signingKey: 'GKEY', serverBaseUrl: 'http://localhost:3001' },
      }),
    }));
    const { buildStellarToml } = await import('../src/services/federation.js');
    expect(buildStellarToml()).toContain('NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"');
  });

  it('leaves ACCOUNTS empty when no platform fee account is configured', async () => {
    vi.doMock('../src/config/env.js', () => ({
      getConfig: () => ({
        stellar: { network: 'testnet', signingKey: 'GKEY', serverBaseUrl: 'http://localhost:3001' },
      }),
    }));
    const { buildStellarToml } = await import('../src/services/federation.js');
    expect(buildStellarToml()).toContain('ACCOUNTS=[]');
  });

  it('populates ACCOUNTS with the platform fee-sponsor public key when configured', async () => {
    process.env.PLATFORM_FEE_ACCOUNT_SECRET = 'S'.repeat(56);
    mockKeypairFromSecret.mockReturnValue({ publicKey: () => 'GFEEACCOUNTPUBLICKEY' });

    vi.doMock('../src/config/env.js', () => ({
      getConfig: () => ({
        stellar: { network: 'testnet', signingKey: 'GKEY', serverBaseUrl: 'http://localhost:3001' },
      }),
    }));
    const { buildStellarToml } = await import('../src/services/federation.js');
    expect(buildStellarToml()).toContain('ACCOUNTS=["GFEEACCOUNTPUBLICKEY"]');
  });
});

describe('#954 routes/stellar/federation.js — GET /stellar.toml', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('serves the shared buildStellarToml() output as text/plain', async () => {
    vi.doMock('../src/config/env.js', () => ({
      getConfig: () => ({
        stellar: { network: 'testnet', signingKey: 'GKEY', serverBaseUrl: 'http://localhost:3001' },
      }),
    }));
    const request = (await import('supertest')).default;
    const express = (await import('express')).default;
    const federationRouter = (await import('../src/routes/stellar/federation.js')).default;

    const app = express();
    app.use('/federation', federationRouter);

    const res = await request(app).get('/federation/stellar.toml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('FEDERATION_SERVER=');
    expect(res.text).toContain('DIRECT_PAYMENT_SERVER=');
  });
});

describe('#954 env.js — signingKey / serverBaseUrl / sorobanRpcUrl config fields', () => {
  const REQUIRED_SECRETS = {
    STREAM_SECRET_ENCRYPTION_KEY: 'x'.repeat(32),
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
  };

  let warnSpy;

  beforeEach(() => {
    // Earlier describe blocks vi.doMock() '../src/config/env.js' with a
    // partial mock; doMock registrations persist across tests until
    // replaced or unmocked, so restore the real module here.
    vi.doUnmock('../src/config/env.js');
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('reads signingKey/serverBaseUrl/sorobanRpcUrl via getConfig().stellar', async () => {
    const { createConfigFromEnv } = await import('../src/config/env.js');
    const cfg = createConfigFromEnv({
      ...REQUIRED_SECRETS,
      STELLAR_SIGNING_KEY: 'GSIGN',
      SERVER_BASE_URL: 'https://api.example.com',
      SOROBAN_RPC_URL: 'https://soroban.example.com',
    });
    expect(cfg.stellar.signingKey).toBe('GSIGN');
    expect(cfg.stellar.serverBaseUrl).toBe('https://api.example.com');
    expect(cfg.stellar.sorobanRpcUrl).toBe('https://soroban.example.com');
  });

  it('rejects an invalid SOROBAN_RPC_URL', async () => {
    const { createConfigFromEnv } = await import('../src/config/env.js');
    expect(() => createConfigFromEnv({ ...REQUIRED_SECRETS, SOROBAN_RPC_URL: 'not-a-url' })).toThrow(
      /SOROBAN_RPC_URL must be a valid URL/,
    );
  });

  it('warns at startup when STELLAR_SIGNING_KEY is empty on a non-testnet network', async () => {
    const { createConfigFromEnv } = await import('../src/config/env.js');
    createConfigFromEnv({
      ...REQUIRED_SECRETS,
      APP_ENV: 'production',
      ALLOWED_ORIGINS: 'https://example.com',
      JWT_SECRET: 'a-real-secret',
      STELLAR_NETWORK: 'mainnet',
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/STELLAR_SIGNING_KEY is not set/));
  });

  it('does not warn on testnet when STELLAR_SIGNING_KEY is empty', async () => {
    const { createConfigFromEnv } = await import('../src/config/env.js');
    createConfigFromEnv({ ...REQUIRED_SECRETS, STELLAR_NETWORK: 'testnet' });
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringMatching(/STELLAR_SIGNING_KEY is not set/));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #955 — SEP-0031 cross-border direct payment
// ─────────────────────────────────────────────────────────────────────────────

describe('#955 services/sep31.js', () => {
  let mockFetch;
  let prisma;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    prisma = (await import('../src/db/client.js')).default;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function tomlResponse(body, { ok = true, status = 200 } = {}) {
    return { ok, status, text: () => Promise.resolve(body) };
  }

  function jsonResponse(body, { ok = true, status = 200 } = {}) {
    return { ok, status, json: () => Promise.resolve(body) };
  }

  it('discoverReceivingAnchor parses DIRECT_PAYMENT_SERVER from the domain stellar.toml', async () => {
    mockFetch.mockResolvedValueOnce(
      tomlResponse('FEDERATION_SERVER="https://anchor.example/federation"\nDIRECT_PAYMENT_SERVER="https://anchor.example/sep31"\n'),
    );
    const { discoverReceivingAnchor } = await import('../src/services/sep31.js');
    const result = await discoverReceivingAnchor('https://anchor.example/');
    expect(result).toEqual({ domain: 'anchor.example', directPaymentServer: 'https://anchor.example/sep31' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://anchor.example/.well-known/stellar.toml',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('discoverReceivingAnchor throws 404 when the anchor does not advertise SEP-0031', async () => {
    mockFetch.mockResolvedValueOnce(tomlResponse('FEDERATION_SERVER="https://anchor.example/federation"\n'));
    const { discoverReceivingAnchor } = await import('../src/services/sep31.js');
    await expect(discoverReceivingAnchor('anchor.example')).rejects.toMatchObject({ status: 404 });
  });

  it('discoverReceivingAnchor throws 400 for an empty domain', async () => {
    const { discoverReceivingAnchor } = await import('../src/services/sep31.js');
    await expect(discoverReceivingAnchor('')).rejects.toMatchObject({ status: 400 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('getAnchorInfo fetches GET /info from the anchor', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ receive: { USD: { asset_code: 'USD' } } }));
    const { getAnchorInfo } = await import('../src/services/sep31.js');
    const info = await getAnchorInfo('https://anchor.example/sep31/');
    expect(info).toEqual({ receive: { USD: { asset_code: 'USD' } } });
    expect(mockFetch).toHaveBeenCalledWith('https://anchor.example/sep31/info', expect.anything());
  });

  it('createCrossBorderTransaction requires amount and asset_code', async () => {
    const { createCrossBorderTransaction } = await import('../src/services/sep31.js');
    await expect(createCrossBorderTransaction('https://anchor.example/sep31', {})).rejects.toMatchObject({
      status: 400,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('createCrossBorderTransaction posts to the anchor and persists the transaction id', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ id: 'anchor-tx-1', stellar_account_id: 'GDEST', stellar_memo: '42', stellar_memo_type: 'id' }),
    );
    prisma.sep31Transaction.create.mockResolvedValue({ id: 'local-row-1' });

    const { createCrossBorderTransaction } = await import('../src/services/sep31.js');
    const result = await createCrossBorderTransaction('https://anchor.example/sep31', {
      amount: '100',
      asset_code: 'USD',
      sender_id: 'GSENDER',
      receiver_id: 'GRECEIVER',
    });

    expect(result.id).toBe('anchor-tx-1');
    expect(result.localRecordId).toBe('local-row-1');
    expect(prisma.sep31Transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          anchorUrl: 'https://anchor.example/sep31',
          externalId: 'anchor-tx-1',
          amount: '100',
          assetCode: 'USD',
        }),
      }),
    );
  });

  it('createCrossBorderTransaction throws when the anchor rejects the request', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'unsupported asset' }, { ok: false, status: 400 }));
    const { createCrossBorderTransaction } = await import('../src/services/sep31.js');
    await expect(
      createCrossBorderTransaction('https://anchor.example/sep31', { amount: '10', asset_code: 'XYZ' }),
    ).rejects.toMatchObject({ status: 400, message: 'unsupported asset' });
  });

  it('createCrossBorderTransaction still returns the anchor result when local persistence fails', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'anchor-tx-2' }));
    prisma.sep31Transaction.create.mockRejectedValue(new Error('db unavailable'));

    const { createCrossBorderTransaction } = await import('../src/services/sep31.js');
    const result = await createCrossBorderTransaction('https://anchor.example/sep31', {
      amount: '5',
      asset_code: 'USD',
    });
    expect(result.id).toBe('anchor-tx-2');
    expect(result.localRecordId).toBeNull();
  });

  it('getTransactionStatus polls the anchor and updates the local tracking row', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ transaction: { id: 'anchor-tx-1', status: 'completed' } }));
    prisma.sep31Transaction.updateMany.mockResolvedValue({ count: 1 });

    const { getTransactionStatus } = await import('../src/services/sep31.js');
    const status = await getTransactionStatus('https://anchor.example/sep31', 'anchor-tx-1');

    expect(status).toEqual({ id: 'anchor-tx-1', status: 'completed' });
    expect(prisma.sep31Transaction.updateMany).toHaveBeenCalledWith({
      where: { anchorUrl: 'https://anchor.example/sep31', externalId: 'anchor-tx-1' },
      data: { status: 'completed' },
    });
  });

  it('getTransactionStatus requires an id', async () => {
    const { getTransactionStatus } = await import('../src/services/sep31.js');
    await expect(getTransactionStatus('https://anchor.example/sep31', '')).rejects.toMatchObject({ status: 400 });
  });
});

describe('#955 routes/stellar/sep31.js', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function buildApp() {
    const express = (await import('express')).default;
    const sep31Router = (await import('../src/routes/stellar/sep31.js')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/stellar/sep31', sep31Router);
    return app;
  }

  it('GET /info returns 422 when domain is missing', async () => {
    const request = (await import('supertest')).default;
    const app = await buildApp();
    const res = await request(app).get('/api/stellar/sep31/info');
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.field)).toContain('domain');
  });

  it('GET /info discovers the anchor and returns its /info payload', async () => {
    vi.doMock('../src/services/sep31.js', () => ({
      discoverReceivingAnchor: vi.fn(() => Promise.resolve({ directPaymentServer: 'https://anchor.example/sep31' })),
      getAnchorInfo: vi.fn(() => Promise.resolve({ receive: { USD: {} } })),
      createCrossBorderTransaction: vi.fn(),
      getTransactionStatus: vi.fn(),
    }));
    const request = (await import('supertest')).default;
    const app = await buildApp();
    const res = await request(app).get('/api/stellar/sep31/info').query({ domain: 'anchor.example' });
    expect(res.status).toBe(200);
    expect(res.body.directPaymentServer).toBe('https://anchor.example/sep31');
    expect(res.body.receive).toEqual({ USD: {} });
  });

  it('POST /transactions returns 422 when amount/assetCode are missing', async () => {
    const request = (await import('supertest')).default;
    const app = await buildApp();
    const res = await request(app)
      .post('/api/stellar/sep31/transactions')
      .send({ anchorUrl: 'https://anchor.example/sep31' });
    expect(res.status).toBe(422);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toContain('amount');
    expect(fields).toContain('assetCode');
  });

  it('POST /transactions creates a transaction via the service', async () => {
    const createMock = vi.fn(() => Promise.resolve({ id: 'anchor-tx-1', localRecordId: 'row-1' }));
    vi.doMock('../src/services/sep31.js', () => ({
      discoverReceivingAnchor: vi.fn(),
      getAnchorInfo: vi.fn(),
      createCrossBorderTransaction: createMock,
      getTransactionStatus: vi.fn(),
    }));
    const request = (await import('supertest')).default;
    const app = await buildApp();
    const res = await request(app).post('/api/stellar/sep31/transactions').send({
      anchorUrl: 'https://anchor.example/sep31',
      amount: '100',
      assetCode: 'USD',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('anchor-tx-1');
    expect(createMock).toHaveBeenCalledWith(
      'https://anchor.example/sep31',
      expect.objectContaining({ amount: '100', asset_code: 'USD' }),
    );
  });

  it('GET /transactions/:id returns 422 when anchorUrl is missing', async () => {
    const request = (await import('supertest')).default;
    const app = await buildApp();
    const res = await request(app).get('/api/stellar/sep31/transactions/anchor-tx-1');
    expect(res.status).toBe(422);
  });

  it('GET /transactions/:id proxies the anchor status through the service', async () => {
    vi.doMock('../src/services/sep31.js', () => ({
      discoverReceivingAnchor: vi.fn(),
      getAnchorInfo: vi.fn(),
      createCrossBorderTransaction: vi.fn(),
      getTransactionStatus: vi.fn(() => Promise.resolve({ id: 'anchor-tx-1', status: 'completed' })),
    }));
    const request = (await import('supertest')).default;
    const app = await buildApp();
    const res = await request(app)
      .get('/api/stellar/sep31/transactions/anchor-tx-1')
      .query({ anchorUrl: 'https://anchor.example/sep31' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('surfaces a service error status/message unchanged', async () => {
    vi.doMock('../src/services/sep31.js', () => ({
      discoverReceivingAnchor: vi.fn(() => Promise.reject(Object.assign(new Error('anchor unreachable'), { status: 502 }))),
      getAnchorInfo: vi.fn(),
      createCrossBorderTransaction: vi.fn(),
      getTransactionStatus: vi.fn(),
    }));
    const request = (await import('supertest')).default;
    const app = await buildApp();
    const res = await request(app).get('/api/stellar/sep31/info').query({ domain: 'anchor.example' });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('anchor unreachable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #956 — Soroban RPC resilience (contract.js)
// ─────────────────────────────────────────────────────────────────────────────

describe('#956 routes/stellar/contract.js — Soroban resilience', () => {
  const VALID_PUBLIC_KEY = 'G' + 'A'.repeat(55);

  let mockGetAccount;
  let mockSimulateTransaction;
  let mockSendTransaction;
  let mockRpcServerCtor;
  let mockGetConfig;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    process.env.STELLAR_CONTRACT_ADDRESS = 'CCONTRACTADDRESS';

    mockGetAccount = vi.fn(() => Promise.resolve({ accountId: () => VALID_PUBLIC_KEY }));
    mockSimulateTransaction = vi.fn(() => Promise.resolve({ result: {}, cost: {}, footprint: {}, events: [] }));
    mockSendTransaction = vi.fn(() => Promise.resolve({ hash: 'tx-hash', status: 'PENDING' }));
    // Must be a `function`, not an arrow — it's invoked via `new StellarSDK.rpc.Server(...)`.
    mockRpcServerCtor = vi.fn(function MockRpcServer() {
      return {
        getAccount: mockGetAccount,
        simulateTransaction: mockSimulateTransaction,
        sendTransaction: mockSendTransaction,
      };
    });
    mockGetConfig = vi.fn(() => ({ stellar: { network: 'testnet', sorobanRpcUrl: 'https://soroban-testnet.stellar.org' } }));

    vi.doMock('../src/config/env.js', () => ({ getConfig: mockGetConfig }));
    vi.doMock('../src/config/logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      withContext: vi.fn(),
    }));

    const { buildStellarSdkMock } = await import('./helpers/sorobanSdkMock.js');
    vi.doMock('@stellar/stellar-sdk', () => buildStellarSdkMock({ rpcServerCtor: mockRpcServerCtor }));
  });

  afterEach(() => {
    delete process.env.STELLAR_CONTRACT_ADDRESS;
  });

  async function buildApp() {
    const express = (await import('express')).default;
    const contractRouter = (await import('../src/routes/stellar/contract.js')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/stellar/contract', contractRouter);
    return app;
  }

  it('reuses a cached Soroban server instance across requests when the URL is unchanged', async () => {
    const request = (await import('supertest')).default;
    const app = await buildApp();

    await request(app)
      .post('/api/stellar/contract/invoke/simulate')
      .send({ functionName: 'get_market', sourcePublicKey: VALID_PUBLIC_KEY });
    await request(app)
      .post('/api/stellar/contract/invoke/simulate')
      .send({ functionName: 'get_market', sourcePublicKey: VALID_PUBLIC_KEY });

    expect(mockRpcServerCtor).toHaveBeenCalledTimes(1);
  });

  it('creates a new Soroban server instance when sorobanRpcUrl changes', async () => {
    const request = (await import('supertest')).default;
    const app = await buildApp();

    mockGetConfig.mockReturnValue({ stellar: { network: 'testnet', sorobanRpcUrl: 'https://rpc-a.example' } });
    await request(app)
      .post('/api/stellar/contract/invoke/simulate')
      .send({ functionName: 'get_market', sourcePublicKey: VALID_PUBLIC_KEY });

    mockGetConfig.mockReturnValue({ stellar: { network: 'testnet', sorobanRpcUrl: 'https://rpc-b.example' } });
    await request(app)
      .post('/api/stellar/contract/invoke/simulate')
      .send({ functionName: 'get_market', sourcePublicKey: VALID_PUBLIC_KEY });

    expect(mockRpcServerCtor).toHaveBeenCalledTimes(2);
  });

  it('retries a transient (503) simulateTransaction failure and succeeds', async () => {
    const transientErr = Object.assign(new Error('Service Unavailable'), { status: 503 });
    mockSimulateTransaction.mockRejectedValueOnce(transientErr).mockResolvedValue({
      result: {},
      cost: {},
      footprint: {},
      events: [],
    });

    const request = (await import('supertest')).default;
    const app = await buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke/simulate')
      .send({ functionName: 'get_market', sourcePublicKey: VALID_PUBLIC_KEY });

    expect(res.status).toBe(200);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry a permanent (400) simulateTransaction failure', async () => {
    const permanentErr = Object.assign(new Error('Bad Request'), { status: 400 });
    mockSimulateTransaction.mockRejectedValue(permanentErr);

    const request = (await import('supertest')).default;
    const app = await buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke/simulate')
      .send({ functionName: 'get_market', sourcePublicKey: VALID_PUBLIC_KEY });

    expect(res.status).toBe(500);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
  });

  it('retries a transient sendTransaction failure on POST /invoke', async () => {
    const transientErr = Object.assign(new Error('Service Unavailable'), { status: 503 });
    mockSendTransaction.mockRejectedValueOnce(transientErr).mockResolvedValue({ hash: 'tx-hash', status: 'PENDING' });

    const request = (await import('supertest')).default;
    const app = await buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke')
      .send({ signedTxXdr: 'AAAA' });

    expect(res.status).toBe(200);
    expect(mockSendTransaction).toHaveBeenCalledTimes(2);
  });

  it('wraps getAccount in the retry helper for POST /invoke/build', async () => {
    const transientErr = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    mockGetAccount.mockRejectedValueOnce(transientErr).mockResolvedValue({ accountId: () => VALID_PUBLIC_KEY });

    const request = (await import('supertest')).default;
    const app = await buildApp();
    const res = await request(app)
      .post('/api/stellar/contract/invoke/build')
      .send({ functionName: 'get_market', sourcePublicKey: VALID_PUBLIC_KEY });

    expect(res.status).toBe(200);
    expect(mockGetAccount).toHaveBeenCalledTimes(2);
  });
});
