/**
 * Property-based performance tests.
 * Verifies that utility functions complete within acceptable time bounds
 * for any valid input, regardless of size or shape.
 */

import * as fc from 'fast-check';
import { describe, it, expect, beforeAll } from 'vitest';
import { formatBalance, formatBalanceWithAsset } from '../frontend/src/utils/formatBalance.js';
import { validateAmount } from '../frontend/src/utils/validateAmount.js';
import { xlmAmount, assetCode } from './generators.js';

const MAX_MS = 50; // per-call budget (generous to account for CI variance)

function timed(fn) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

// Warm up locale formatting to avoid ICU cold-start skewing results
beforeAll(() => {
  for (let i = 0; i < 20; i++) formatBalance(Math.random() * 1e6);
});

describe('Performance — utility functions complete within time bounds', () => {
  it('formatBalance completes within budget for any numeric input', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (num) => {
        expect(timed(() => formatBalance(num))).toBeLessThan(MAX_MS);
      }),
      { numRuns: 200 }
    );
  });

  it('validateAmount completes within budget for any string input', () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 0, max: 1_000_000 }), (str, balance) => {
        expect(timed(() => validateAmount(str, balance))).toBeLessThan(MAX_MS);
      }),
      { numRuns: 200 }
    );
  });

  it('formatBalanceWithAsset completes within budget for valid domain inputs', () => {
    fc.assert(
      fc.property(xlmAmount(), assetCode(), (amount, asset) => {
        expect(timed(() => formatBalanceWithAsset(amount, asset))).toBeLessThan(MAX_MS);
      }),
      { numRuns: 200 }
    );
  });
});
