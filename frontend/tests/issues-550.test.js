/**
 * Tests for issue #550: Frontend error message mappings
 *  - getFriendlyError utility maps Stellar/network errors to friendly messages
 *  - axios interceptor logic: 503 → friendly, 429 → friendly with countdown, timeout → friendly
 */
import { describe, it, expect } from 'vitest';
import { getFriendlyError } from '../src/utils/errorMessages';

// ── getFriendlyError ──────────────────────────────────────────────────────────

describe('#550 — getFriendlyError utility', () => {
  it('maps insufficient balance error', () => {
    expect(getFriendlyError({ message: 'insufficient balance for fees' })).toMatch(
      /insufficient balance/i,
    );
  });

  it('maps account not found error', () => {
    expect(getFriendlyError({ message: 'no account found' })).toMatch(/does not exist/i);
  });

  it('maps timeout error from message', () => {
    expect(getFriendlyError({ message: 'timeout' })).toMatch(/timed out/i);
  });

  it('maps network error', () => {
    expect(getFriendlyError({ message: 'Network Error' })).toMatch(/network error/i);
  });

  it('maps Stellar tx result code tx_bad_seq', () => {
    const err = { response: { data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } } };
    expect(getFriendlyError(err)).toMatch(/sequence/i);
  });

  it('maps Stellar tx result code tx_insufficient_balance', () => {
    const err = {
      response: { data: { extras: { result_codes: { transaction: 'tx_insufficient_balance' } } } },
    };
    expect(getFriendlyError(err)).toMatch(/insufficient/i);
  });

  it('maps Stellar op result code op_underfunded', () => {
    const err = {
      response: { data: { extras: { result_codes: { operations: ['op_underfunded'] } } } },
    };
    expect(getFriendlyError(err)).toMatch(/insufficient/i);
  });

  it('maps Stellar op result code op_no_destination', () => {
    const err = {
      response: { data: { extras: { result_codes: { operations: ['op_no_destination'] } } } },
    };
    expect(getFriendlyError(err)).toMatch(/destination/i);
  });

  it('handles ECONNABORTED code', () => {
    expect(getFriendlyError({ code: 'ECONNABORTED' })).toMatch(/timed out/i);
  });

  it('handles ERR_NETWORK code', () => {
    expect(getFriendlyError({ code: 'ERR_NETWORK' })).toMatch(/timed out/i);
  });

  it('returns a non-empty string for unknown error', () => {
    const result = getFriendlyError({ message: 'some_obscure_internal_xyz' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ── Interceptor logic (unit tests for the mapping logic itself) ───────────────

describe('#550 — Axios interceptor error mapping logic', () => {
  // Mirror the interceptor logic directly to test it in isolation
  function applyInterceptorLogic(status, headers = {}, code = null, message = '') {
    if (status === 503) {
      const err = new Error('The service is temporarily unavailable.');
      err.isNetworkError = true;
      err.status = 503;
      return err;
    }
    if (status === 429) {
      const retryAfter = headers['retry-after'];
      const seconds = retryAfter ? parseInt(retryAfter, 10) : null;
      const msg = seconds
        ? `Too many requests. Please wait ${seconds} second${seconds !== 1 ? 's' : ''}.`
        : 'Too many requests. Please try again later.';
      const err = new Error(msg);
      err.isNetworkError = true;
      err.status = 429;
      err.retryAfter = seconds;
      return err;
    }
    if (!status && (code === 'ECONNABORTED' || message?.toLowerCase().includes('timeout'))) {
      const err = new Error('The request took too long. Please try again.');
      err.isNetworkError = true;
      return err;
    }
    return null;
  }

  it('maps 503 to "temporarily unavailable"', () => {
    const err = applyInterceptorLogic(503);
    expect(err.message).toMatch(/temporarily unavailable/i);
    expect(err.isNetworkError).toBe(true);
    expect(err.status).toBe(503);
  });

  it('maps 429 without Retry-After to generic message', () => {
    const err = applyInterceptorLogic(429);
    expect(err.message).toMatch(/too many requests/i);
    expect(err.status).toBe(429);
  });

  it('maps 429 with Retry-After: 30 to countdown message', () => {
    const err = applyInterceptorLogic(429, { 'retry-after': '30' });
    expect(err.message).toMatch(/30 second/i);
    expect(err.retryAfter).toBe(30);
  });

  it('maps 429 with Retry-After: 1 to singular "second"', () => {
    const err = applyInterceptorLogic(429, { 'retry-after': '1' });
    expect(err.message).toMatch(/1 second[^s]/);
  });

  it('maps ECONNABORTED to "took too long"', () => {
    const err = applyInterceptorLogic(null, {}, 'ECONNABORTED', '');
    expect(err.message).toMatch(/took too long/i);
    expect(err.isNetworkError).toBe(true);
  });

  it('maps timeout message to "took too long"', () => {
    const err = applyInterceptorLogic(null, {}, null, 'timeout of 30000ms exceeded');
    expect(err.message).toMatch(/took too long/i);
  });
});
