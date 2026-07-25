/**
 * Property-based tests for frontend utility functions.
 * Tests invariants that must hold for all valid inputs.
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { validateAmount } from '../frontend/src/utils/validateAmount.js';
import { formatBalance, formatBalanceWithAsset } from '../frontend/src/utils/formatBalance.js';
import { xlmAmount, assetCode } from './generators.js';

describe('validateAmount — invariants', () => {
  it('returns null (valid) for any well-formed XLM amount within balance', () => {
    fc.assert(
      fc.property(xlmAmount(), (amount) => {
        const balance = parseFloat(amount) + 1;
        expect(validateAmount(amount, balance)).toBeNull();
      })
    );
  });

  it('always returns an error string for zero or negative amounts', () => {
    fc.assert(
      fc.property(fc.float({ min: -1e6, max: 0, noNaN: true }), (num) => {
        const result = validateAmount(String(num), 1000);
        expect(typeof result).toBe('string');
      })
    );
  });

  it('always returns an error when amount exceeds balance', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 1000 }),
        fc.integer({ min: 1, max: 9 }),
        (amount, balance) => {
          // amount (10-1000) always > balance (1-9)
          const result = validateAmount(amount.toFixed(7), balance);
          expect(typeof result).toBe('string');
        }
      )
    );
  });

  it('rejects scientific notation for any exponent', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), (exp) => {
        expect(validateAmount(`1e${exp}`, 1e200)).not.toBeNull();
        expect(validateAmount(`1E-${exp}`, 1e200)).not.toBeNull();
      })
    );
  });
});

describe('formatBalance — invariants', () => {
  it('always returns a string', () => {
    fc.assert(
      fc.property(fc.anything(), (val) => {
        expect(typeof formatBalance(val)).toBe('string');
      })
    );
  });

  it('never returns empty string for numeric input', () => {
    fc.assert(
      fc.property(fc.float({ noNaN: true, noDefaultInfinity: true }), (num) => {
        expect(formatBalance(num).length).toBeGreaterThan(0);
      })
    );
  });

  it('returns "—" for null, undefined, and empty string', () => {
    for (const val of [null, undefined, '']) {
      expect(formatBalance(val)).toBe('—');
    }
  });

  it('formatBalanceWithAsset always includes the asset code when provided', () => {
    fc.assert(
      fc.property(xlmAmount(), assetCode(), (amount, asset) => {
        const result = formatBalanceWithAsset(amount, asset);
        expect(result).toContain(asset);
      })
    );
  });
});
