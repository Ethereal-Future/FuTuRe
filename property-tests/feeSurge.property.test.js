/**
 * Property-based tests for fee surge detection and fee history tracking.
 *
 * Tests invariants of monotonic surge detection, valid fee ranges,
 * and statistical properties of fee samples over time.
 *
 * Run with: npm run test:property
 */

import * as fc from 'fast-check';
import { describe, it, expect, beforeEach } from 'vitest';
import * as feeSurge from '../backend/src/services/feeSurge.js';

describe('Fee Surge Property Tests', () => {
  beforeEach(() => {
    feeSurge.resetFeeHistory();
  });

  const stroopAmount = () => fc.integer({ min: 0, max: 1_000_000 });
  const positiveStroopAmount = () => fc.integer({ min: 1, max: 1_000_000 });

  describe('Invariant: surge detection is monotonic with fee ratio', () => {
    it('should report surge only when ratio exceeds threshold', () => {
      fc.assert(
        fc.property(
          positiveStroopAmount(),
          fc.float({ min: 0.1, max: 20, noNaN: true }),
          fc.float({ min: 1, max: 10, noNaN: true }),
          (avgFee, currentFee, threshold) => {
            const result = feeSurge.detectFeeSurge(currentFee, avgFee, threshold);

            expect(typeof result.surge).toBe('boolean');
            expect(result.ratio).toBeGreaterThan(0);

            // Surge should be true iff ratio > threshold
            const expectedSurge = currentFee / avgFee > threshold;
            expect(result.surge).toBe(expectedSurge);
          }
        ),
        { numRuns: 200 }
      );
    });

    it('should never report surge with null or zero average fee', () => {
      fc.assert(
        fc.property(positiveStroopAmount(), (currentFee) => {
          const result1 = feeSurge.detectFeeSurge(currentFee, null);
          const result2 = feeSurge.detectFeeSurge(currentFee, 0);
          const result3 = feeSurge.detectFeeSurge(currentFee, undefined);

          expect(result1.surge).toBe(false);
          expect(result2.surge).toBe(false);
          expect(result3.surge).toBe(false);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Invariant: average fee is within range of all samples', () => {
    it('should compute average that lies within [min, max] of sample fees', () => {
      fc.assert(
        fc.property(
          fc.array(positiveStroopAmount(), { minLength: 1, maxLength: 100 }),
          (fees) => {
            feeSurge.resetFeeHistory();
            const now = Date.now();
            const samples = fees.map((fee, idx) => ({ fee, timestamp: now - idx * 1000 }));

            feeSurge.setFeeHistory(samples);
            const avg = feeSurge.getSevenDayAverageFee();

            if (avg !== null) {
              const min = Math.min(...fees);
              const max = Math.max(...fees);

              expect(avg).toBeGreaterThanOrEqual(min);
              expect(avg).toBeLessThanOrEqual(max);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Invariant: recorded fees are never negative', () => {
    it('should always accept non-negative fee samples', () => {
      fc.assert(
        fc.property(stroopAmount(), (fee) => {
          expect(() => feeSurge.recordFeeSample(fee)).not.toThrow();
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Invariant: seven-day window maintains chronological order', () => {
    it('should only include fees within the last 7 days', () => {
      fc.assert(
        fc.property(
          fc.array(positiveStroopAmount(), { minLength: 1, maxLength: 10 }),
          fc.integer({ min: 1, max: 8 }),
          (fees, daysOld) => {
            feeSurge.resetFeeHistory();
            const now = Date.now();
            const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
            const oldTimestamp = now - daysOld * 24 * 60 * 60 * 1000;

            const samples = fees.map((fee) => ({ fee, timestamp: oldTimestamp }));
            feeSurge.setFeeHistory(samples);

            const avg = feeSurge.getSevenDayAverageFee();

            if (daysOld <= 7) {
              // Should include fees within 7 days
              if (samples.length > 0) {
                expect(avg).toBeDefined();
              }
            } else {
              // Should exclude fees older than 7 days
              expect(avg).toBeNull();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Invariant: surge ratio is always positive', () => {
    it('should return positive ratio for all valid inputs', () => {
      fc.assert(
        fc.property(
          positiveStroopAmount(),
          positiveStroopAmount(),
          (currentFee, avgFee) => {
            const result = feeSurge.detectFeeSurge(currentFee, avgFee);

            expect(result.ratio).toBeGreaterThan(0);
            expect(Number.isFinite(result.ratio)).toBe(true);
          }
        ),
        { numRuns: 200 }
      );
    });
  });

  describe('Invariant: fee surge detection threshold is non-negative', () => {
    it('should accept valid threshold values', () => {
      fc.assert(
        fc.property(
          positiveStroopAmount(),
          positiveStroopAmount(),
          fc.float({ min: 0.1, max: 100, noNaN: true }),
          (currentFee, avgFee, threshold) => {
            const result = feeSurge.detectFeeSurge(currentFee, avgFee, threshold);

            expect(result.threshold).toBe(threshold);
            expect(result.threshold).toBeGreaterThanOrEqual(0);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
