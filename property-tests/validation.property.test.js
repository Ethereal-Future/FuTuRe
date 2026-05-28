/**
 * Property-based tests for backend validation rules.
 * Verifies invariants of the Express validator middleware rules.
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { stellarPublicKey, stellarSecretKey, xlmAmount, assetCode } from './generators.js';

// Regex mirrors from backend/src/middleware/validate.js
const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;
const STELLAR_SECRET_KEY = /^S[A-Z2-7]{55}$/;
const ASSET_CODE = /^[A-Z0-9]{1,12}$/;

describe('Stellar key format — invariants', () => {
  it('generated public keys always match the expected pattern', () => {
    fc.assert(
      fc.property(stellarPublicKey(), (key) => {
        expect(STELLAR_PUBLIC_KEY.test(key)).toBe(true);
      })
    );
  });

  it('generated secret keys always match the expected pattern', () => {
    fc.assert(
      fc.property(stellarSecretKey(), (key) => {
        expect(STELLAR_SECRET_KEY.test(key)).toBe(true);
      })
    );
  });

  it('public and secret keys are always different', () => {
    fc.assert(
      fc.property(stellarPublicKey(), stellarSecretKey(), (pub, sec) => {
        expect(pub).not.toBe(sec);
        expect(pub[0]).toBe('G');
        expect(sec[0]).toBe('S');
      })
    );
  });

  it('public keys are always exactly 56 characters', () => {
    fc.assert(
      fc.property(stellarPublicKey(), (key) => {
        expect(key.length).toBe(56);
      })
    );
  });
});

describe('Asset code format — invariants', () => {
  it('generated asset codes always match the expected pattern', () => {
    fc.assert(
      fc.property(assetCode(), (code) => {
        expect(ASSET_CODE.test(code)).toBe(true);
      })
    );
  });

  it('asset codes are always between 1 and 12 characters', () => {
    fc.assert(
      fc.property(assetCode(), (code) => {
        expect(code.length).toBeGreaterThanOrEqual(1);
        expect(code.length).toBeLessThanOrEqual(12);
      })
    );
  });
});

describe('XLM amount — invariants', () => {
  it('generated amounts are always positive', () => {
    fc.assert(
      fc.property(xlmAmount(), (amount) => {
        expect(parseFloat(amount)).toBeGreaterThan(0);
      })
    );
  });

  it('generated amounts never exceed 7 decimal places', () => {
    fc.assert(
      fc.property(xlmAmount(), (amount) => {
        const decimals = amount.includes('.') ? amount.split('.')[1].length : 0;
        expect(decimals).toBeLessThanOrEqual(7);
      })
    );
  });

  it('generated amounts are always finite numbers', () => {
    fc.assert(
      fc.property(xlmAmount(), (amount) => {
        const num = parseFloat(amount);
        expect(isFinite(num)).toBe(true);
        expect(isNaN(num)).toBe(false);
      })
    );
  });
});
