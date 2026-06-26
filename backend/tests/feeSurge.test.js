import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordFeeSample,
  getSevenDayAverageFee,
  detectFeeSurge,
  resetFeeHistory,
  setFeeHistory,
  SURGE_THRESHOLD,
} from '../src/services/feeSurge.js';

describe('fee surge detection', () => {
  beforeEach(() => {
    resetFeeHistory();
  });

  describe('getSevenDayAverageFee', () => {
    it('returns null when no samples exist', () => {
      expect(getSevenDayAverageFee()).toBeNull();
    });

    it('computes average from recorded samples', () => {
      recordFeeSample(100);
      recordFeeSample(200);
      recordFeeSample(300);
      expect(getSevenDayAverageFee()).toBe(200);
    });

    it('excludes samples older than 7 days', () => {
      const now = Date.now();
      setFeeHistory([
        { fee: 100, timestamp: now - 8 * 24 * 60 * 60 * 1000 },
        { fee: 200, timestamp: now - 1 * 24 * 60 * 60 * 1000 },
      ]);
      expect(getSevenDayAverageFee()).toBe(200);
    });
  });

  describe('detectFeeSurge', () => {
    it('does not flag surge when fee is within threshold', () => {
      const result = detectFeeSurge(400, 100);
      expect(result.surge).toBe(false);
      expect(result.ratio).toBe(4);
    });

    it('flags surge when current fee exceeds 5x average', () => {
      const result = detectFeeSurge(600, 100);
      expect(result.surge).toBe(true);
      expect(result.ratio).toBe(6);
      expect(result.threshold).toBe(SURGE_THRESHOLD);
    });

    it('does not flag surge when average is zero or missing', () => {
      expect(detectFeeSurge(1000, 0).surge).toBe(false);
      expect(detectFeeSurge(1000, null).surge).toBe(false);
    });

    it('respects custom threshold', () => {
      const result = detectFeeSurge(300, 100, 2);
      expect(result.surge).toBe(true);
      expect(result.threshold).toBe(2);
    });
  });
});
