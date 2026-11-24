/**
 * Tests for ISSUE-1683: stellarStream exponential backoff on reconnection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeBackoff } from '../src/services/stellarStream.js';

describe('computeBackoff (ISSUE-1683)', () => {
  it('returns 0 for the first attempt when jitter lands at 0', () => {
    // Math.random() === 0 means floor(0 * ceiling) === 0
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(computeBackoff(0)).toBe(0);
    vi.restoreAllMocks();
  });

  it('increases the ceiling with each attempt', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    const d0 = computeBackoff(0); // ceiling = min(60000, 1000 * 2^0) = 1000
    const d1 = computeBackoff(1); // ceiling = min(60000, 1000 * 2^1) = 2000
    const d2 = computeBackoff(2); // ceiling = min(60000, 1000 * 2^2) = 4000
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
    vi.restoreAllMocks();
  });

  it('never exceeds the 60-second cap', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9999);
    // Attempt 10 → ceiling = min(60000, 1000 * 2^10 = 1024000) = 60000
    const delay = computeBackoff(10);
    expect(delay).toBeLessThan(60_000);
    vi.restoreAllMocks();
  });

  it('returns a non-negative integer', () => {
    for (let i = 0; i < 10; i++) {
      const delay = computeBackoff(i);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(delay)).toBe(true);
    }
  });

  it('caps at BACKOFF_MAX_MS for large attempt numbers', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1 - Number.EPSILON);
    const delay = computeBackoff(100); // 1000 * 2^100 >> 60000
    expect(delay).toBeLessThanOrEqual(60_000);
    vi.restoreAllMocks();
  });
});
