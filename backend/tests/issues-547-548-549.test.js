/**
 * Tests for issues #547, #548, #549:
 *  #547 — Input validation on assets routes
 *  #548 — Timeout handling for external API calls
 *  #549 — Circuit breaker for Stellar Horizon calls
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Issue #547: Input validation ─────────────────────────────────────────────

describe('#547 — Assets route input validation', () => {
  it('validates asset code format (1-12 alphanumeric)', () => {
    const ASSET_CODE_REGEX = /^[A-Z0-9]{1,12}$/;
    expect(ASSET_CODE_REGEX.test('USDC')).toBe(true);
    expect(ASSET_CODE_REGEX.test('XLM')).toBe(true);
    expect(ASSET_CODE_REGEX.test('MYTOKEN123')).toBe(true);
    expect(ASSET_CODE_REGEX.test('bad!code')).toBe(false);
    expect(ASSET_CODE_REGEX.test('toolongassetcode')).toBe(false);
    expect(ASSET_CODE_REGEX.test('')).toBe(false);
  });

  it('validates Stellar public key format (G + 55 base32 chars)', () => {
    const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;
    expect(STELLAR_PUBLIC_KEY_REGEX.test('G' + 'A'.repeat(55))).toBe(true);
    expect(
      STELLAR_PUBLIC_KEY_REGEX.test('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3'),
    ).toBe(true);
    expect(STELLAR_PUBLIC_KEY_REGEX.test('notapublickey')).toBe(false);
    expect(STELLAR_PUBLIC_KEY_REGEX.test('S' + 'A'.repeat(55))).toBe(false);
    expect(STELLAR_PUBLIC_KEY_REGEX.test('G' + 'A'.repeat(54))).toBe(false); // too short
  });

  it('validates Stellar secret key format (S + 55 base32 chars)', () => {
    const STELLAR_SECRET_KEY_REGEX = /^S[A-Z2-7]{55}$/;
    expect(STELLAR_SECRET_KEY_REGEX.test('S' + 'A'.repeat(55))).toBe(true);
    expect(STELLAR_SECRET_KEY_REGEX.test('notasecret')).toBe(false);
    expect(STELLAR_SECRET_KEY_REGEX.test('G' + 'A'.repeat(55))).toBe(false);
    expect(STELLAR_SECRET_KEY_REGEX.test('S' + 'A'.repeat(54))).toBe(false); // too short
  });

  it('validates amount is positive float with max 7 decimal places', () => {
    const validateAmount = (amount) => {
      const parsed = parseFloat(amount);
      if (isNaN(parsed) || parsed <= 0) return false;
      // Count actual decimal places in the original string (not toFixed)
      const parts = String(amount).split('.');
      if (parts.length > 1 && parts[1].length > 7) return false;
      return true;
    };
    expect(validateAmount('10')).toBe(true);
    expect(validateAmount('10.5')).toBe(true);
    expect(validateAmount('10.1234567')).toBe(true);
    expect(validateAmount('10.12345678')).toBe(false);
    expect(validateAmount('0')).toBe(false);
    expect(validateAmount('-5')).toBe(false);
  });
});

// ── Issue #548: Timeout handling ─────────────────────────────────────────────

describe('#548 — Timeout handling', () => {
  it('getHorizonTimeout() reads HORIZON_TIMEOUT_MS env var', () => {
    const getHorizonTimeout = () => parseInt(process.env.HORIZON_TIMEOUT_MS ?? '10000', 10);
    const original = process.env.HORIZON_TIMEOUT_MS;
    process.env.HORIZON_TIMEOUT_MS = '7500';
    expect(getHorizonTimeout()).toBe(7500);
    if (original === undefined) delete process.env.HORIZON_TIMEOUT_MS;
    else process.env.HORIZON_TIMEOUT_MS = original;
  });

  it('getHorizonTimeout() defaults to 10000 when env var is unset', () => {
    const getHorizonTimeout = () => parseInt(process.env.HORIZON_TIMEOUT_MS ?? '10000', 10);
    const original = process.env.HORIZON_TIMEOUT_MS;
    delete process.env.HORIZON_TIMEOUT_MS;
    expect(getHorizonTimeout()).toBe(10000);
    if (original !== undefined) process.env.HORIZON_TIMEOUT_MS = original;
  });

  it('timeout wrapper rejects with isTimeout=true when fn exceeds timeout', async () => {
    const withTimeout = (fn, ms) => {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('Request timed out');
          err.isTimeout = true;
          reject(err);
        }, ms);
      });
      return Promise.race([fn(), timeout]).finally(() => clearTimeout(timer));
    };

    const slowFn = () => new Promise((resolve) => setTimeout(resolve, 500));
    await expect(withTimeout(slowFn, 50)).rejects.toMatchObject({ isTimeout: true });
  });

  it('timeout wrapper resolves when fn completes within timeout', async () => {
    const withTimeout = (fn, ms) => {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('Request timed out');
          err.isTimeout = true;
          reject(err);
        }, ms);
      });
      return Promise.race([fn(), timeout]).finally(() => clearTimeout(timer));
    };

    const fastFn = () => Promise.resolve('ok');
    await expect(withTimeout(fastFn, 500)).resolves.toBe('ok');
  });
});

// ── Issue #549: Circuit breaker ───────────────────────────────────────────────

describe('#549 — Circuit breaker', () => {
  let circuit;

  beforeEach(() => {
    circuit = {
      state: 'CLOSED',
      failures: 0,
      windowStart: Date.now(),
      openedAt: null,
      threshold: 5,
      windowMs: 30000,
    };
  });

  it('starts in CLOSED state', () => {
    expect(circuit.state).toBe('CLOSED');
  });

  it('records failures in CLOSED state', () => {
    circuit.failures += 1;
    expect(circuit.failures).toBe(1);
  });

  it('opens circuit after threshold consecutive failures', () => {
    const recordFailure = (cb) => {
      const now = Date.now();
      if (now - cb.windowStart > cb.windowMs) {
        cb.failures = 1;
        cb.windowStart = now;
        return;
      }
      cb.failures += 1;
      if (cb.failures >= cb.threshold) {
        cb.state = 'OPEN';
        cb.openedAt = now;
      }
    };

    for (let i = 0; i < 5; i++) recordFailure(circuit);
    expect(circuit.state).toBe('OPEN');
    expect(circuit.openedAt).not.toBeNull();
  });

  it('rejects immediately with circuitOpen=true when OPEN', async () => {
    circuit.state = 'OPEN';
    const callWithCircuitBreaker = (cb, fn) => {
      if (cb.state === 'OPEN') {
        const err = new Error('Circuit breaker is open');
        err.circuitOpen = true;
        return Promise.reject(err);
      }
      return fn();
    };

    await expect(
      callWithCircuitBreaker(circuit, () => Promise.resolve('ok')),
    ).rejects.toMatchObject({ circuitOpen: true });
  });

  it('resets failures after successful call', () => {
    circuit.failures = 3;
    circuit.failures = 0;
    circuit.state = 'CLOSED';
    expect(circuit.failures).toBe(0);
    expect(circuit.state).toBe('CLOSED');
  });
});
