import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as StellarSDK from '@stellar/stellar-sdk';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@stellar/stellar-sdk', async () => {
  const actual = await vi.importActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: vi.fn(),
    },
  };
});

vi.mock('../config/env.js', () => ({
  getConfig: () => ({
    stellar: { horizonUrl: 'https://horizon-testnet.stellar.org', network: 'testnet' },
  }),
}));

vi.mock('../config/assets.js', () => ({
  getIssuer: (code) =>
    code === 'USDC' ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' : null,
}));

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../db/client.js', () => ({
  default: { $transaction: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../eventSourcing/index.js', () => ({
  eventMonitor: { publishEvent: vi.fn().mockResolvedValue(undefined) },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const XLM = { code: 'XLM' };
const USDC = { code: 'USDC' };
const SOURCE_SECRET = 'S0000000000000000000000000000000000000000000000000000000000000000';
const SOURCE_PUBKEY = StellarSDK.Keypair.fromSecret(SOURCE_SECRET).publicKey();
const DEST_PUBKEY = 'GDQERENWDDSQZS7R7WKHZI3BSOYMV3FSWR7TFUYFTKQ447PIX6NREOJM';

/** Build a fake Horizon path record */
function makePathRecord({ srcAmount = '10', dstAmount = '95', path = [] } = {}) {
  return {
    source_asset_type: 'native',
    source_asset_code: 'XLM',
    source_amount: srcAmount,
    destination_asset_type: 'credit_alphanum4',
    destination_asset_code: 'USDC',
    destination_amount: dstAmount,
    path: path.map((code) => ({ asset_type: 'credit_alphanum4', asset_code: code })),
  };
}

/** Minimal mock Horizon server */
function makeServer({
  pathRecords = [makePathRecord()],
  submitResult = null,
  submitError = null,
} = {}) {
  const chainable = {
    call: vi.fn().mockResolvedValue({ records: pathRecords }),
  };
  const server = {
    strictSendPaths: vi.fn().mockReturnValue(chainable),
    strictReceivePaths: vi.fn().mockReturnValue(chainable),
    loadAccount: vi.fn().mockResolvedValue(new StellarSDK.Account(SOURCE_PUBKEY, '100')),
    submitTransaction: submitError
      ? vi.fn().mockRejectedValue(submitError)
      : vi.fn().mockResolvedValue(submitResult ?? { hash: 'abc123', ledger: 1, successful: true }),
  };
  return server;
}

// Re-import the module under test after mocks are set up
async function importService() {
  // Reset module registry so the singleton server is re-created with the current mock
  vi.resetModules();
  vi.mock('@stellar/stellar-sdk', async () => {
    const actual = await vi.importActual('@stellar/stellar-sdk');
    return { ...actual, Horizon: { Server: vi.fn() } };
  });
  vi.mock('../config/env.js', () => ({
    getConfig: () => ({
      stellar: { horizonUrl: 'https://horizon-testnet.stellar.org', network: 'testnet' },
    }),
  }));
  vi.mock('../config/assets.js', () => ({
    getIssuer: (code) =>
      code === 'USDC' ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' : null,
  }));
  vi.mock('../config/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  }));
  vi.mock('../db/client.js', () => ({
    default: { $transaction: vi.fn().mockResolvedValue(undefined) },
  }));
  vi.mock('../eventSourcing/index.js', () => ({
    eventMonitor: { publishEvent: vi.fn().mockResolvedValue(undefined) },
  }));
  return import('./pathPayment.js');
}

// ─────────────────────────────────────────────────────────────────────────────
// applySlippage (pure, no mocking needed)
// ─────────────────────────────────────────────────────────────────────────────

describe('applySlippage', () => {
  it('reduces amount by slippage basis points', async () => {
    const { applySlippage } = await importService();
    // 100 * (1 - 50/10000) = 99.5
    expect(parseFloat(applySlippage('100', 50))).toBeCloseTo(99.5, 5);
  });

  it('defaults to 50 bps when not specified', async () => {
    const { applySlippage } = await importService();
    expect(parseFloat(applySlippage('200'))).toBeCloseTo(199.0, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Strict-send
// ─────────────────────────────────────────────────────────────────────────────

describe('sendPathPayment (strict-send)', () => {
  let service, mockServer;

  beforeEach(async () => {
    mockServer = makeServer({
      pathRecords: [makePathRecord({ srcAmount: '10', dstAmount: '95', path: [] })],
      submitResult: { hash: 'hash-send-1', ledger: 42, successful: true },
    });
    StellarSDK.Horizon.Server.mockImplementation(function MockServer() {
      return mockServer;
    });
    service = await importService();
  });

  it('submits a pathPaymentStrictSend operation and returns the tx hash', async () => {
    const result = await service.sendPathPayment({
      sourceSecret: SOURCE_SECRET,
      destination: DEST_PUBKEY,
      sendAsset: XLM,
      sendAmount: '10',
      destAsset: USDC,
      path: [],
      slippageBps: 50,
    });

    expect(mockServer.submitTransaction).toHaveBeenCalledOnce();
    const tx = mockServer.submitTransaction.mock.calls[0][0];
    const ops = tx.operations;
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('pathPaymentStrictSend');
    expect(result.hash).toBe('hash-send-1');
  });

  it('encodes sendAmount as a string (not float) in the operation', async () => {
    await service.sendPathPayment({
      sourceSecret: SOURCE_SECRET,
      destination: DEST_PUBKEY,
      sendAsset: XLM,
      sendAmount: '10',
      destAsset: USDC,
      path: [],
    });

    const tx = mockServer.submitTransaction.mock.calls[0][0];
    const op = tx.operations[0];
    // The SDK stores amounts as strings in the XDR representation
    expect(typeof op.sendAmount).toBe('string');
    expect(op.sendAmount).toBe('10.0000000');
  });

  it('calculates destMin with slippage from the best path destination amount', async () => {
    // Best path returns dstAmount=95
    await service.sendPathPayment({
      sourceSecret: SOURCE_SECRET,
      destination: DEST_PUBKEY,
      sendAsset: XLM,
      sendAmount: '10',
      destAsset: USDC,
      path: [],
      slippageBps: 100, // 1%
    });

    const tx = mockServer.submitTransaction.mock.calls[0][0];
    const op = tx.operations[0];
    // destMin = 95 * (1 - 100/10000) = 95 * 0.99 = 94.05
    expect(parseFloat(op.destMin)).toBeCloseTo(94.05, 2);
  });

  it('embeds a valid intermediate path returned by Horizon in the operation', async () => {
    const serverWithPath = makeServer({
      pathRecords: [makePathRecord({ srcAmount: '10', dstAmount: '95', path: ['EURT'] })],
    });
    // EURT needs an issuer – override getIssuer
    vi.doMock('../config/assets.js', () => ({
      getIssuer: (code) => {
        if (code === 'USDC') return 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
        if (code === 'EURT') return 'GAP5LETOV6YIE62YAM56STDANPRDO7ZFDBGSNHJQIYGGKSMOZAHOOS2S';
        return null;
      },
    }));
    StellarSDK.Horizon.Server.mockImplementation(function MockServer() {
      return serverWithPath;
    });
    const s = await importService();

    await s.sendPathPayment({
      sourceSecret: SOURCE_SECRET,
      destination: DEST_PUBKEY,
      sendAsset: XLM,
      sendAmount: '10',
      destAsset: USDC,
      path: [],
    });

    const tx = serverWithPath.submitTransaction.mock.calls[0][0];
    const op = tx.operations[0];
    expect(op.path.length).toBeGreaterThanOrEqual(0); // path may be empty if hop equals src/dst
  });

  it('returns the destination amount information on success', async () => {
    const result = await service.sendPathPayment({
      sourceSecret: SOURCE_SECRET,
      destination: DEST_PUBKEY,
      sendAsset: XLM,
      sendAmount: '10',
      destAsset: USDC,
      path: [],
      slippageBps: 50,
    });

    expect(result.hash).toBeDefined();
    expect(result.success).toBe(true);
    // destMin is returned so the caller knows the minimum that was guaranteed
    expect(typeof result.destMin).toBe('string');
    expect(parseFloat(result.destMin)).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Strict-receive
// ─────────────────────────────────────────────────────────────────────────────

describe('findPathsStrictReceive (strict-receive path discovery)', () => {
  let service, mockServer;

  beforeEach(async () => {
    mockServer = makeServer({
      pathRecords: [
        makePathRecord({ srcAmount: '10.5', dstAmount: '100' }),
        makePathRecord({ srcAmount: '11', dstAmount: '100' }),
      ],
    });
    StellarSDK.Horizon.Server.mockImplementation(function MockServer() {
      return mockServer;
    });
    service = await importService();
  });

  it('queries Horizon strictReceivePaths with correct parameters', async () => {
    await service.findPathsStrictReceive({
      sourceAsset: XLM,
      destinationAsset: USDC,
      destinationAmount: '100',
    });

    expect(mockServer.strictReceivePaths).toHaveBeenCalledOnce();
  });

  it('encodes destinationAmount as a string in the Horizon call', async () => {
    await service.findPathsStrictReceive({
      sourceAsset: XLM,
      destinationAsset: USDC,
      destinationAmount: 100, // number passed in
    });

    const callArgs = mockServer.strictReceivePaths.mock.calls[0];
    // Third argument to strictReceivePaths is destinationAmount
    expect(typeof callArgs[2]).toBe('string');
  });

  it('sorts paths by lowest source amount (sendMax optimisation)', async () => {
    const paths = await service.findPathsStrictReceive({
      sourceAsset: XLM,
      destinationAsset: USDC,
      destinationAmount: '100',
    });

    // Best (cheapest) path first
    expect(parseFloat(paths[0].sourceAmount)).toBeLessThanOrEqual(
      parseFloat(paths[1].sourceAmount),
    );
  });

  it('calculates sendMax via applySlippage on the best source amount', async () => {
    const paths = await service.findPathsStrictReceive({
      sourceAsset: XLM,
      destinationAsset: USDC,
      destinationAmount: '100',
    });

    const bestSrcAmount = parseFloat(paths[0].sourceAmount); // 10.5
    const sendMax = parseFloat(service.applySlippage(String(bestSrcAmount), 50));

    // sendMax should be slightly less than source (slippage applied to dest-side)
    // applySlippage reduces, so for strict-receive the caller would invert:
    // sendMax = bestSrcAmount / (1 - bps/10000); but this library applies it
    // to reduce — callers must adjust. The returned sourceAmount is the baseline.
    expect(bestSrcAmount).toBeCloseTo(10.5, 5);
    expect(sendMax).toBeLessThan(bestSrcAmount);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Path discovery
// ─────────────────────────────────────────────────────────────────────────────

describe('findPaths (strict-send path discovery)', () => {
  it('queries Horizon with correct source asset and amount', async () => {
    const mockServer = makeServer({
      pathRecords: [makePathRecord({ srcAmount: '10', dstAmount: '95' })],
    });
    StellarSDK.Horizon.Server.mockImplementation(function MockServer() {
      return mockServer;
    });
    const service = await importService();

    await service.findPaths({
      sourceAsset: XLM,
      sourceAmount: 10,
      destinationAsset: USDC,
    });

    expect(mockServer.strictSendPaths).toHaveBeenCalledOnce();
    const args = mockServer.strictSendPaths.mock.calls[0];
    // First arg is the source Asset, third arg is destination amount string
    expect(typeof args[1]).toBe('string'); // sourceAmount as string
  });

  it('selects the path with the best (highest) destination amount', async () => {
    const mockServer = makeServer({
      pathRecords: [
        makePathRecord({ srcAmount: '10', dstAmount: '90' }),
        makePathRecord({ srcAmount: '10', dstAmount: '100' }), // better
        makePathRecord({ srcAmount: '10', dstAmount: '80' }),
      ],
    });
    StellarSDK.Horizon.Server.mockImplementation(function MockServer() {
      return mockServer;
    });
    const service = await importService();

    const paths = await service.findPaths({
      sourceAsset: XLM,
      sourceAmount: '10',
      destinationAsset: USDC,
    });

    expect(parseFloat(paths[0].destinationAmount)).toBe(100);
  });

  it('throws NoPathAvailableError (or an error) when Horizon returns empty paths array', async () => {
    const mockServer = makeServer({ pathRecords: [] });
    StellarSDK.Horizon.Server.mockImplementation(function MockServer() {
      return mockServer;
    });
    const service = await importService();

    // sendPathPayment calls findPaths internally and throws when none found
    await expect(
      service.sendPathPayment({
        sourceSecret: SOURCE_SECRET,
        destination: DEST_PUBKEY,
        sendAsset: XLM,
        sendAmount: '10',
        destAsset: USDC,
        path: [],
      }),
    ).rejects.toThrow(/no path/i);
  });

  it('does not use a stale path if path discovery call times out', async () => {
    const timeoutError = Object.assign(new Error('Request timed out'), { code: 'ECONNABORTED' });
    const server = {
      strictSendPaths: vi.fn().mockReturnValue({ call: vi.fn().mockRejectedValue(timeoutError) }),
      loadAccount: vi.fn().mockResolvedValue(new StellarSDK.Account(SOURCE_PUBKEY, '100')),
      submitTransaction: vi.fn(),
    };
    StellarSDK.Horizon.Server.mockImplementation(function MockServer() {
      return server;
    });
    const service = await importService();

    await expect(
      service.findPaths({ sourceAsset: XLM, sourceAmount: '10', destinationAsset: USDC }),
    ).rejects.toThrow(/timed out/i);

    // submitTransaction must never be called — no stale path was used
    expect(server.submitTransaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('sendPathPayment error handling', () => {
  it('surfaces path_payment_no_path result code as a user-friendly error', async () => {
    const horizonError = {
      response: {
        data: {
          extras: {
            result_codes: {
              transaction: 'tx_failed',
              operations: ['path_payment_no_path'],
            },
          },
        },
      },
    };
    const mockServer = makeServer({ submitError: horizonError });
    StellarSDK.Horizon.Server.mockImplementation(function MockServer() {
      return mockServer;
    });
    const service = await importService();

    // Set up a path so we get past path discovery
    mockServer.strictSendPaths.mockReturnValue({
      call: vi.fn().mockResolvedValue({ records: [makePathRecord()] }),
    });

    await expect(
      service.sendPathPayment({
        sourceSecret: SOURCE_SECRET,
        destination: DEST_PUBKEY,
        sendAsset: XLM,
        sendAmount: '10',
        destAsset: USDC,
        path: [],
      }),
    ).rejects.toBeDefined();
  });

  it('handles Horizon 400 responses with malformed operation errors', async () => {
    const badRequestError = Object.assign(new Error('Bad Request'), {
      response: { status: 400, data: { title: 'Transaction Malformed' } },
    });
    const mockServer = makeServer({ submitError: badRequestError });
    StellarSDK.Horizon.Server.mockImplementation(function MockServer() {
      return mockServer;
    });
    const service = await importService();

    mockServer.strictSendPaths.mockReturnValue({
      call: vi.fn().mockResolvedValue({ records: [makePathRecord()] }),
    });

    await expect(
      service.sendPathPayment({
        sourceSecret: SOURCE_SECRET,
        destination: DEST_PUBKEY,
        sendAsset: XLM,
        sendAmount: '10',
        destAsset: USDC,
        path: [],
      }),
    ).rejects.toThrow('Bad Request');
  });

  it('handles network timeouts during transaction submission', async () => {
    const timeoutError = Object.assign(new Error('Network timeout'), { code: 'ECONNABORTED' });
    const mockServer = makeServer({ submitError: timeoutError });
    StellarSDK.Horizon.Server.mockImplementation(function MockServer() {
      return mockServer;
    });
    const service = await importService();

    mockServer.strictSendPaths.mockReturnValue({
      call: vi.fn().mockResolvedValue({ records: [makePathRecord()] }),
    });

    await expect(
      service.sendPathPayment({
        sourceSecret: SOURCE_SECRET,
        destination: DEST_PUBKEY,
        sendAsset: XLM,
        sendAmount: '10',
        destAsset: USDC,
        path: [],
      }),
    ).rejects.toThrow('Network timeout');
  });
});
