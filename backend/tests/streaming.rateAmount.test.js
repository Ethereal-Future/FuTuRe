import { describe, it, expect } from 'vitest';
import { validateRateAmount, MIN_STREAM_RATE_AMOUNT } from '../src/services/streaming.js';

describe('validateRateAmount (#1373)', () => {
  it('accepts amounts with at most 7 decimal places at or above the minimum', () => {
    expect(validateRateAmount('1')).toBe(1);
    expect(validateRateAmount('0.00001')).toBe(0.00001);
    expect(validateRateAmount(0.00001)).toBe(0.00001);
    expect(validateRateAmount('10.1234567')).toBe(10.1234567);
  });

  it('rejects amounts with 8+ decimal places', () => {
    expect(() => validateRateAmount('0.00000001')).toThrow(/7 decimal places/);
    expect(() => validateRateAmount('0.000000005')).toThrow(/7 decimal places/);
    try {
      validateRateAmount('1.12345678');
    } catch (err) {
      expect(err.code).toBe('RATE_AMOUNT_INVALID');
    }
  });

  it('rejects sub-minimum dust amounts', () => {
    expect(() => validateRateAmount('0.000001')).toThrow(/at least/);
    expect(() => validateRateAmount(MIN_STREAM_RATE_AMOUNT / 10)).toThrow();
  });
});
