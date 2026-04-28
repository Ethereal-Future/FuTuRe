import { describe, it, expect } from 'vitest';
import { validateAmount, formatAmount } from '../src/utils/validateAmount';
import { getFriendlyError } from '../src/utils/errorMessages';

// ── validateAmount ────────────────────────────────────────────────────────────
describe('validateAmount', () => {
  it('returns null for a valid amount', () => {
    expect(validateAmount('10', null)).toBeNull();
  });

  it('returns null when value is empty', () => {
    expect(validateAmount('', null)).toBeNull();
  });

  it('rejects zero', () => {
    expect(validateAmount('0', null)).toMatch(/positive/i);
  });

  it('rejects negative numbers', () => {
    expect(validateAmount('-5', null)).toMatch(/positive/i);
  });

  it('rejects scientific notation', () => {
    expect(validateAmount('1e5', null)).toMatch(/scientific/i);
  });

  it('rejects amounts below minimum (0.0000001)', () => {
    expect(validateAmount('0.00000001', null)).toMatch(/minimum/i);
  });

  it('rejects more than 7 decimal places', () => {
    expect(validateAmount('1.12345678', null)).toMatch(/decimal/i);
  });

  it('accepts exactly 7 decimal places', () => {
    expect(validateAmount('1.1234567', null)).toBeNull();
  });

  it('rejects amount exceeding available balance', () => {
    expect(validateAmount('100', 50)).toMatch(/exceeds/i);
  });

  it('accepts amount equal to available balance', () => {
    expect(validateAmount('50', 50)).toBeNull();
  });

  it('skips balance check when availableBalance is null', () => {
    expect(validateAmount('999999', null)).toBeNull();
  });
});

// ── formatAmount ──────────────────────────────────────────────────────────────
describe('formatAmount', () => {
  it('strips leading zeros', () => {
    expect(formatAmount('007')).toBe('7');
  });

  it('preserves "0." prefix', () => {
    expect(formatAmount('0.5')).toBe('0.5');
  });

  it('leaves normal values unchanged', () => {
    expect(formatAmount('42')).toBe('42');
  });
});

// ── getFriendlyError ──────────────────────────────────────────────────────────
describe('getFriendlyError', () => {
  it('maps insufficient balance error', () => {
    const err = { message: 'insufficient balance' };
    expect(getFriendlyError(err)).toMatch(/Insufficient balance/i);
  });

  it('maps account not found error', () => {
    const err = { message: 'no account found' };
    expect(getFriendlyError(err)).toMatch(/does not exist/i);
  });

  it('maps network error', () => {
    const err = { message: 'Network error' };
    expect(getFriendlyError(err)).toMatch(/Network error/i);
  });

  it('maps timeout error', () => {
    const err = { message: 'Request timeout' };
    expect(getFriendlyError(err)).toMatch(/timed out/i);
  });

  it('maps bad sequence error', () => {
    const err = { message: 'bad sequence' };
    expect(getFriendlyError(err)).toMatch(/sequence error/i);
  });

  it('maps tx_failed error', () => {
    const err = { message: 'tx_failed' };
    expect(getFriendlyError(err)).toMatch(/rejected/i);
  });

  it('uses response data error when available', () => {
    const err = { response: { data: { error: 'insufficient balance' } }, message: 'Request failed' };
    expect(getFriendlyError(err)).toMatch(/Insufficient balance/i);
  });

  it('returns generic message for unknown errors', () => {
    const err = { message: 'some unknown thing' };
    expect(getFriendlyError(err)).toMatch(/Something went wrong/i);
  });
});
