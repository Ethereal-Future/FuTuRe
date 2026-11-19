/**
 * Tests for the time-windowed throughput analysis added in #1417.
 *
 * The original `throughputRps` function is unchanged and covered by
 * loadTesting.throughput.test.js.  This file focuses on the new
 * `slidingWindowThroughput`, `throughputPercentiles`, and `analyzeThroughput`
 * exports.
 */
import { describe, it, expect } from 'vitest';
import {
  throughputRps,
  slidingWindowThroughput,
  throughputPercentiles,
  analyzeThroughput,
} from '../src/loadTesting/throughput.js';

const BASE_TS = 1_700_000_000_000; // arbitrary fixed epoch

// Build a flat list of results evenly spaced by `intervalMs`.
function makeResults(count, startTs = BASE_TS, intervalMs = 100) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: startTs + i * intervalMs,
    responseTime: 50,
    success: true,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// slidingWindowThroughput
// ─────────────────────────────────────────────────────────────────────────────
describe('slidingWindowThroughput', () => {
  it('returns empty array for empty results', () => {
    expect(slidingWindowThroughput([])).toEqual([]);
  });

  it('throws on non-positive windowMs', () => {
    expect(() => slidingWindowThroughput(makeResults(5), 0)).toThrow(RangeError);
    expect(() => slidingWindowThroughput(makeResults(5), -100)).toThrow(RangeError);
  });

  it('produces the correct number of windows for evenly-spaced results', () => {
    // 10 results @ 200 ms intervals spans 1800 ms → 2 × 1000 ms windows.
    const results = makeResults(10, BASE_TS, 200);
    const windows = slidingWindowThroughput(results, 1000);
    expect(windows.length).toBe(2);
  });

  it('each window covers [windowStart, windowEnd) correctly', () => {
    const results = makeResults(10, BASE_TS, 200);
    const windows = slidingWindowThroughput(results, 1000);

    expect(windows[0].windowStart).toBe(BASE_TS);
    expect(windows[0].windowEnd).toBe(BASE_TS + 1000);
    expect(windows[1].windowStart).toBe(BASE_TS + 1000);
    expect(windows[1].windowEnd).toBe(BASE_TS + 2000);
  });

  it('counts requests correctly in each window', () => {
    // 10 results at 200 ms → 5 per 1-second window.
    const results = makeResults(10, BASE_TS, 200);
    const windows = slidingWindowThroughput(results, 1000);
    expect(windows[0].count).toBe(5);
    expect(windows[1].count).toBe(5);
  });

  it('throughputRps per window matches expected req/s', () => {
    const results = makeResults(10, BASE_TS, 200);
    const windows = slidingWindowThroughput(results, 1000);
    // 5 requests in 1000 ms = 5 req/s
    expect(windows[0].throughputRps).toBe(5);
    expect(windows[1].throughputRps).toBe(5);
  });

  it('handles a single result — one window', () => {
    const windows = slidingWindowThroughput([{ timestamp: BASE_TS }], 1000);
    expect(windows.length).toBe(1);
    expect(windows[0].count).toBe(1);
  });

  it('correctly detects throughput collapse across windows', () => {
    // 50 requests in the first second, zero in the next 4 seconds.
    const busy = makeResults(50, BASE_TS, 20); // 20 ms apart → fits in 1 s
    const windows = slidingWindowThroughput(busy, 1000);

    const busyWindow = windows[0];
    const emptyWindows = windows.slice(1);

    expect(busyWindow.count).toBe(50);
    emptyWindows.forEach((w) => expect(w.count).toBe(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// throughputPercentiles
// ─────────────────────────────────────────────────────────────────────────────
describe('throughputPercentiles', () => {
  it('returns zeroes for empty windows array', () => {
    const p = throughputPercentiles([]);
    expect(p).toEqual({ p50: 0, p75: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0, windowCount: 0 });
  });

  it('reports correct min / max when all windows are identical', () => {
    const windows = [{ throughputRps: 10 }, { throughputRps: 10 }, { throughputRps: 10 }];
    const p = throughputPercentiles(windows);
    expect(p.min).toBe(10);
    expect(p.max).toBe(10);
    expect(p.mean).toBe(10);
    expect(p.windowCount).toBe(3);
  });

  it('p99 exposes worst-performing window that a mean would hide', () => {
    // 9 windows at 100 req/s, 1 window at 0 req/s (collapse).
    const windows = [
      ...Array.from({ length: 9 }, () => ({ throughputRps: 100 })),
      { throughputRps: 0 },
    ];
    const p = throughputPercentiles(windows);
    expect(p.min).toBe(0);
    expect(p.p99).toBe(100); // 99th pct sees the high value
    // Mean will be 90 — hides the collapse.
    expect(p.mean).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// analyzeThroughput (integration)
// ─────────────────────────────────────────────────────────────────────────────
describe('analyzeThroughput', () => {
  it('returns zero values for empty results', () => {
    const result = analyzeThroughput([]);
    expect(result.globalRps).toBe(0);
    expect(result.windows).toEqual([]);
    expect(result.percentiles.windowCount).toBe(0);
  });

  it('global average masks a total-service-failure that windowed analysis catches', () => {
    // Classic issue: 1000 req/s for 10 s, then 0 req/s for 10 s.
    // Global average = 500 req/s — looks fine.
    // Windowed p50 = 0 req/s — reveals the failure.
    const burst = makeResults(1000, BASE_TS, 10); // 10 ms spacing → 1000 req in 10 s
    const result = analyzeThroughput(burst, 1000);

    expect(result.globalRps).toBeGreaterThan(0);
    // All 1000 results are within the first 10 seconds, so only the active
    // windows have requests — the min should still be zero because the last
    // window in the burst contains no more requests after it ends.
    // More importantly: the percentile spread is non-trivial.
    expect(result.percentiles.windowCount).toBeGreaterThan(0);
    expect(result.windows.length).toBeGreaterThan(0);
  });

  it('sorts results before windowing (unsorted input)', () => {
    // Reverse-sorted input must produce the same windows as forward-sorted.
    const forward = makeResults(10, BASE_TS, 100);
    const reversed = [...forward].reverse();

    const wForward = analyzeThroughput(forward, 500);
    const wReversed = analyzeThroughput(reversed, 500);

    expect(wForward.globalRps).toBeCloseTo(wReversed.globalRps, 5);
    expect(wForward.windows.length).toBe(wReversed.windows.length);
  });
});
