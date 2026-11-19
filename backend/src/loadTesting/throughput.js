/**
 * Throughput utilities for load-testing analysis.
 *
 * Fixes #1417: A single global average hides cold-start delays, GC pauses,
 * and throughput collapse during resource exhaustion.  This module adds
 * sliding-window time-series analysis and percentile breakdown so that
 * consumers can see exactly *when* throughput degraded, not just the mean.
 */

/**
 * Compute request throughput in requests per second (req/s).
 *
 * @param {number} totalRequests
 * @param {number} durationMs elapsed wall time in milliseconds
 * @returns {number} throughput in req/s, or 0 when duration is non-positive
 */
export function throughputRps(totalRequests, durationMs) {
  if (!totalRequests || !durationMs || durationMs <= 0) return 0;
  return totalRequests / (durationMs / 1000);
}

/**
 * Slice a sorted array of result objects into fixed-size time windows and
 * compute per-window throughput (req/s).
 *
 * Each result must have a numeric `timestamp` field (Unix epoch in ms).
 * Results **must** be sorted by timestamp in ascending order before calling
 * this function (the load-test runner already does this).
 *
 * @param {Array<{timestamp: number}>} results   Raw request results.
 * @param {number} windowMs                       Window width in milliseconds (default 1 000 ms).
 * @returns {Array<{windowStart: number, windowEnd: number, count: number, throughputRps: number}>}
 */
export function slidingWindowThroughput(results, windowMs = 1000) {
  if (!results || results.length === 0) return [];
  if (windowMs <= 0) throw new RangeError('windowMs must be a positive number');

  const firstTs = results[0].timestamp;
  const lastTs = results[results.length - 1].timestamp;

  // Build non-overlapping contiguous windows from the first timestamp.
  const windows = [];
  let windowStart = firstTs;
  let bucketIndex = 0; // pointer into results

  while (windowStart <= lastTs) {
    const windowEnd = windowStart + windowMs;
    let count = 0;

    // Advance bucketIndex past any results that fall before this window
    // (handles floating-point edge cases on re-entry).
    while (bucketIndex < results.length && results[bucketIndex].timestamp < windowStart) {
      bucketIndex++;
    }

    // Count results that land in [windowStart, windowEnd).
    const scanStart = bucketIndex;
    for (let i = scanStart; i < results.length; i++) {
      if (results[i].timestamp >= windowEnd) break;
      count++;
    }

    windows.push({
      windowStart,
      windowEnd,
      count,
      throughputRps: throughputRps(count, windowMs),
    });

    windowStart = windowEnd;
  }

  return windows;
}

/**
 * Compute throughput percentile statistics across all time windows.
 *
 * Returns p50, p75, p95, p99, min, max, and mean window throughput values
 * (all in req/s).  This makes it easy to spot the tail of bad windows that
 * a mean would hide.
 *
 * @param {Array<{throughputRps: number}>} windows  Output of `slidingWindowThroughput`.
 * @returns {{
 *   p50: number, p75: number, p95: number, p99: number,
 *   min: number, max: number, mean: number,
 *   windowCount: number
 * }}
 */
export function throughputPercentiles(windows) {
  if (!windows || windows.length === 0) {
    return { p50: 0, p75: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0, windowCount: 0 };
  }

  const sorted = windows.map((w) => w.throughputRps).sort((a, b) => a - b);
  const n = sorted.length;

  const percentile = (p) => {
    const idx = Math.min(Math.floor(n * p), n - 1);
    return sorted[idx];
  };

  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;

  return {
    p50: percentile(0.5),
    p75: percentile(0.75),
    p95: percentile(0.95),
    p99: percentile(0.99),
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    windowCount: n,
  };
}

/**
 * High-level helper: given raw results and an optional window size, return
 * the complete time-series analysis in a single call.
 *
 * @param {Array<{timestamp: number}>} results
 * @param {number} [windowMs=1000]
 * @returns {{
 *   globalRps: number,
 *   windows: ReturnType<typeof slidingWindowThroughput>,
 *   percentiles: ReturnType<typeof throughputPercentiles>
 * }}
 */
export function analyzeThroughput(results, windowMs = 1000) {
  if (!results || results.length === 0) {
    return {
      globalRps: 0,
      windows: [],
      percentiles: throughputPercentiles([]),
    };
  }

  // Sort defensively — callers may not guarantee order.
  const sorted = [...results].sort((a, b) => a.timestamp - b.timestamp);
  const totalMs = sorted[sorted.length - 1].timestamp - sorted[0].timestamp;

  const globalRps = throughputRps(sorted.length, totalMs);
  const windows = slidingWindowThroughput(sorted, windowMs);
  const percentiles = throughputPercentiles(windows);

  return { globalRps, windows, percentiles };
}
