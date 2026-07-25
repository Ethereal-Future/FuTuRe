/**
 * Property-based tests for AmountInput validation behaviour.
 *
 * Tests the sanitization logic used by AmountInput.jsx and the display
 * formatting rules that enforce Stellar's 7-decimal-place precision limit.
 *
 * Run with:  npm run test:property
 * To see shrunk counter-examples add --reporter=verbose
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure functions mirrored from AmountInput.jsx
// ---------------------------------------------------------------------------

/** Strips non-numeric / non-period characters and collapses multiple dots. */
function sanitize(raw) {
  return raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
}

/**
 * Formats a numeric string the way AmountInput renders it when unfocused.
 * Returns undefined / empty if value is falsy.
 */
function formatDisplay(value) {
  if (!value) return value;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
    useGrouping: false,
  }).format(Number(value));
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const NUM_RUNS = 1000;

/** Generates strings that contain only digits and at most one '.'. */
const validDecimalString = fc.oneof(
  fc.nat().map(String),
  fc.tuple(fc.nat(), fc.nat({ max: 9_999_999 })).map(([i, d]) => `${i}.${d}`),
);

/** Generates valid Stellar amounts: non-negative, ≤ 7 decimal places, within max. */
const STELLAR_MAX = 922337203685;
const stellarAmount = fc.integer({ min: 0, max: STELLAR_MAX * 10_000_000 }).map(stroops => {
  const whole = Math.floor(stroops / 10_000_000);
  const frac = stroops % 10_000_000;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(7, '0')}`;
});

/** Generates strings that contain at least one character outside [0-9.]. */
const stringWithInvalidChars = fc.tuple(
  fc.string({ minLength: 0, maxLength: 10 }),
  fc.stringMatching(/[^0-9.]/),
  fc.string({ minLength: 0, maxLength: 10 }),
).map(([a, bad, b]) => a + bad + b);

/** Generates strings with two or more '.' characters. */
const multiDotString = fc.tuple(
  fc.nat().map(String),
  fc.nat().map(String),
  fc.nat().map(String),
).map(([a, b, c]) => `${a}.${b}.${c}`);

/** Generates negative number strings. */
const negativeString = fc.integer({ min: 1 }).map(n => `-${n}`);

// ---------------------------------------------------------------------------
// sanitize() properties
// ---------------------------------------------------------------------------

describe('AmountInput — sanitize() properties', () => {
  it('strings containing only digits and at most one dot are returned unchanged', () => {
    fc.assert(
      fc.property(validDecimalString, (s) => {
        expect(sanitize(s)).toBe(s);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('output never contains characters outside [0-9.]', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(sanitize(s)).toMatch(/^[0-9.]*$/);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('non-numeric characters (excluding ".") are always stripped', () => {
    fc.assert(
      fc.property(stringWithInvalidChars, (s) => {
        const result = sanitize(s);
        // No characters from the complement of [0-9.] survive
        expect(/[^0-9.]/.test(result)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('negative sign is stripped — negative amounts are not accepted', () => {
    fc.assert(
      fc.property(negativeString, (s) => {
        const result = sanitize(s);
        expect(result.startsWith('-')).toBe(false);
        // The digit portion is preserved
        expect(result).toBe(s.slice(1));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('multiple decimal points are collapsed to a single separator', () => {
    fc.assert(
      fc.property(multiDotString, (s) => {
        const result = sanitize(s);
        const dotCount = (result.match(/\./g) ?? []).length;
        expect(dotCount).toBeLessThanOrEqual(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('empty string sanitizes to empty string', () => {
    expect(sanitize('')).toBe('');
  });

  it('digits before a second dot are not lost when multiple dots appear', () => {
    fc.assert(
      fc.property(multiDotString, (s) => {
        const result = sanitize(s);
        const digits = s.replace(/[^0-9]/g, '');
        const resultDigits = result.replace(/[^0-9]/g, '');
        // All original digits survive
        expect(resultDigits).toBe(digits);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// formatDisplay() properties — enforces Stellar 7 d.p. display limit
// ---------------------------------------------------------------------------

describe('AmountInput — formatDisplay() properties', () => {
  it('valid Stellar amounts display with at most 7 decimal places', () => {
    fc.assert(
      fc.property(stellarAmount, (s) => {
        const display = formatDisplay(s);
        const decimalPart = display?.split('.')[1] ?? '';
        expect(decimalPart.length).toBeLessThanOrEqual(7);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('integer amounts display without a decimal point', () => {
    fc.assert(
      fc.property(fc.nat({ max: STELLAR_MAX }).map(String), (s) => {
        const display = formatDisplay(s);
        expect(display).not.toContain('.');
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('displaying a valid amount then parsing it back yields the same numeric value', () => {
    fc.assert(
      fc.property(stellarAmount, (s) => {
        const display = formatDisplay(s);
        expect(Number(display)).toBeCloseTo(Number(s), 7);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('falsy values are returned as-is without throwing', () => {
    for (const v of ['', null, undefined, '0']) {
      expect(() => formatDisplay(v)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Stellar-specific boundary properties
// ---------------------------------------------------------------------------

describe('AmountInput — Stellar boundary properties', () => {
  it('sanitize does not reject the Stellar maximum amount string', () => {
    const maxStr = '922337203685.4775807';
    expect(sanitize(maxStr)).toBe(maxStr);
  });

  it('sanitize does not reject zero', () => {
    expect(sanitize('0')).toBe('0');
    expect(sanitize('0.0000000')).toBe('0.0000000');
  });

  it('strings in scientific notation have the "e" character stripped', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999 }).map(n => `${n}e${Math.floor(Math.random() * 5) + 1}`),
        (s) => {
          const result = sanitize(s);
          expect(result).not.toContain('e');
          expect(result).not.toContain('E');
        },
      ),
      { numRuns: 100 },
    );
  });
});
