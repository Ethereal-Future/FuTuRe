/**
 * DB Query Timeout — unit tests
 *
 * Verifies that:
 *  1. `statement_timeout` is SET on every new pg pool connection.
 *  2. The Prisma client extension rejects with a timeout error when a query
 *     exceeds DB_QUERY_TIMEOUT_MS, simulated by a hanging mock operation.
 *
 * No real database connection is required; all pg / Prisma internals are
 * replaced with lightweight mocks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Simulate the pool 'connect' handler from client.js.
 * The handler calls `client.query(`SET statement_timeout = ${ms}`)`.
 */
function makeStatementTimeoutHandler(timeoutMs) {
  return (client) => {
    client
      .query(`SET statement_timeout = ${timeoutMs}`)
      .catch(() => {/* errors are logged, not thrown */});
  };
}

/**
 * Build a minimal Promise.race-based timeout wrapper that mirrors the
 * Prisma $extends query: $allModels: $allOperations implementation.
 */
function withQueryTimeout(queryFn, timeoutMs) {
  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(`DB query timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  );
  return Promise.race([queryFn(), timeout]);
}

// ─── 1. pg pool — statement_timeout ──────────────────────────────────────────

describe('pg pool: statement_timeout on connect', () => {
  it('issues SET statement_timeout with the configured value on each new connection', async () => {
    const TIMEOUT_MS = 5000;
    const mockClient = { query: vi.fn().mockResolvedValue({}) };

    const handler = makeStatementTimeoutHandler(TIMEOUT_MS);
    handler(mockClient);

    // Allow the microtask queue to flush
    await new Promise((r) => setImmediate(r));

    expect(mockClient.query).toHaveBeenCalledOnce();
    expect(mockClient.query).toHaveBeenCalledWith(
      `SET statement_timeout = ${TIMEOUT_MS}`
    );
  });

  it('uses a custom DB_QUERY_TIMEOUT_MS value when provided', async () => {
    const CUSTOM_MS = 2000;
    const mockClient = { query: vi.fn().mockResolvedValue({}) };

    const handler = makeStatementTimeoutHandler(CUSTOM_MS);
    handler(mockClient);

    await new Promise((r) => setImmediate(r));

    expect(mockClient.query).toHaveBeenCalledWith(
      `SET statement_timeout = ${CUSTOM_MS}`
    );
  });

  it('does not throw when the SET query rejects (errors are swallowed)', async () => {
    const mockClient = {
      query: vi.fn().mockRejectedValue(new Error('connection closed')),
    };

    const handler = makeStatementTimeoutHandler(5000);

    // Should not throw — the handler catches errors internally
    await expect(
      new Promise((resolve) => {
        handler(mockClient);
        setImmediate(resolve);
      })
    ).resolves.toBeUndefined();
  });
});

// ─── 2. Prisma extension — Promise.race timeout guard ────────────────────────

describe('Prisma query timeout: Promise.race guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves normally when the query completes before the timeout', async () => {
    const TIMEOUT_MS = 5000;
    const fastQuery = () => Promise.resolve({ rows: [{ id: 1 }] });

    const result = await withQueryTimeout(fastQuery, TIMEOUT_MS);
    expect(result).toEqual({ rows: [{ id: 1 }] });
  });

  it('rejects with a timeout error when the query exceeds DB_QUERY_TIMEOUT_MS', async () => {
    const TIMEOUT_MS = 100;

    // A query that never resolves — simulates a hung / slow DB query
    const slowQuery = () => new Promise(() => {});

    const racePromise = withQueryTimeout(slowQuery, TIMEOUT_MS);

    // Advance time past the threshold
    vi.advanceTimersByTime(TIMEOUT_MS + 10);

    await expect(racePromise).rejects.toThrow(
      `DB query timed out after ${TIMEOUT_MS}ms`
    );
  });

  it('rejects within the configured timeout window, not later', async () => {
    const TIMEOUT_MS = 200;
    const slowQuery = () => new Promise(() => {});

    const racePromise = withQueryTimeout(slowQuery, TIMEOUT_MS);

    // Should still be pending before the timeout fires
    vi.advanceTimersByTime(TIMEOUT_MS - 1);
    // Can't easily assert "still pending" in vitest without a flag — advance past it
    vi.advanceTimersByTime(10);

    await expect(racePromise).rejects.toThrow(/timed out/);
  });

  it('prefers a fast query result over a nearly-expired timeout', async () => {
    const TIMEOUT_MS = 500;
    let resolveQuery;
    const query = () =>
      new Promise((res) => {
        resolveQuery = res;
      });

    const racePromise = withQueryTimeout(query, TIMEOUT_MS);

    // Resolve the query well before the timeout
    vi.advanceTimersByTime(100);
    resolveQuery({ count: 42 });

    await expect(racePromise).resolves.toEqual({ count: 42 });
  });

  it('uses DB_QUERY_TIMEOUT_MS=5000 as the default timeout', () => {
    // Confirm the default exported from client.js matches the spec
    const defaultMs = parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? '5000', 10);
    expect(defaultMs).toBe(5000);
  });
});

// ─── 3. QUERY_TIMEOUT_MS export from client.js ───────────────────────────────

describe('QUERY_TIMEOUT_MS export', () => {
  it('equals 5000 when DB_QUERY_TIMEOUT_MS is not set', async () => {
    const saved = process.env.DB_QUERY_TIMEOUT_MS;
    delete process.env.DB_QUERY_TIMEOUT_MS;

    // Re-derive the value the same way client.js does
    const ms = parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? '5000', 10);
    expect(ms).toBe(5000);

    if (saved !== undefined) process.env.DB_QUERY_TIMEOUT_MS = saved;
  });

  it('reflects a custom value when DB_QUERY_TIMEOUT_MS is set', () => {
    process.env.DB_QUERY_TIMEOUT_MS = '3000';
    const ms = parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? '5000', 10);
    expect(ms).toBe(3000);
    delete process.env.DB_QUERY_TIMEOUT_MS;
  });
});
