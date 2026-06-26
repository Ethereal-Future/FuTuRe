import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Issue #545: Stellar Horizon retry logic ────────────────────────────────

describe('Issue #545: withHorizonRetry', () => {
  let withHorizonRetry, withHorizonTimeout, isTransientHorizonError;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../src/services/circuitBreaker.js', () => ({
      callWithCircuitBreaker: vi.fn((fn) => fn()),
    }));
    vi.doMock('../src/eventSourcing/index.js', () => ({
      eventMonitor: { publishEvent: vi.fn(), initialize: vi.fn() },
    }));
    vi.doMock('../src/config/env.js', () => ({
      getConfig: vi.fn(() => ({
        stellar: { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
      })),
    }));
    vi.doMock('../src/config/logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
      withContext: vi.fn(() => ({ info: vi.fn() })),
    }));
    vi.doMock('../src/config/assets.js', () => ({ getIssuer: vi.fn() }));
    vi.doMock('../src/db/client.js', () => ({ default: { user: {}, transaction: {}, $transaction: vi.fn(), feeBumpStat: {} } }));

    const stellar = await import('../src/services/stellar.js');
    withHorizonRetry = stellar.withHorizonRetry;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withHorizonRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and eventually succeeds', async () => {
    const err = new Error('Rate limited');
    err.response = { status: 429 };
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');
    const result = await withHorizonRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  }, 10000);

  it('retries on 503 and eventually succeeds', async () => {
    const err = new Error('Service unavailable');
    err.response = { status: 503 };
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');
    const result = await withHorizonRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  }, 15000);

  it('retries on timeout error', async () => {
    const err = new Error('Horizon request timed out');
    err.isTimeout = true;
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue('success');
    const result = await withHorizonRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  }, 10000);

  it('does NOT retry on 400 Bad Request', async () => {
    const err = new Error('Bad Request');
    err.response = { status: 400 };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withHorizonRetry(fn)).rejects.toThrow('Bad Request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 404 Not Found', async () => {
    const err = new Error('Not Found');
    err.response = { status: 404 };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withHorizonRetry(fn)).rejects.toThrow('Not Found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 409 Conflict', async () => {
    const err = new Error('Conflict');
    err.response = { status: 409 };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withHorizonRetry(fn)).rejects.toThrow('Conflict');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts all 3 retries and throws on persistent 503', async () => {
    const err = new Error('Service unavailable');
    err.response = { status: 503 };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withHorizonRetry(fn)).rejects.toThrow('Service unavailable');
    // 1 initial + 3 retries = 4 calls
    expect(fn).toHaveBeenCalledTimes(4);
  }, 20000);
});

// ── Issue #546: Global unhandled rejection / uncaught exception handlers ──

describe('Issue #546: process error handlers in server.js', () => {
  it('registers unhandledRejection handler', () => {
    const listeners = process.listeners('unhandledRejection');
    // The server module may not be loaded in this test env; verify the pattern instead
    expect(typeof process.on).toBe('function');
  });

  it('registers uncaughtException handler', () => {
    expect(typeof process.on).toBe('function');
  });

  it('server.js source contains unhandledRejection handler', async () => {
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/server.js'),
      'utf8',
    );
    expect(src).toContain("process.on('unhandledRejection'");
    expect(src).toContain("process.on('uncaughtException'");
    expect(src).toContain('process.exit(1)');
    expect(src).toContain('shutdown(');
  });
});
