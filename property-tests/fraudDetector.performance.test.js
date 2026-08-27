/**
 * #1118 — load/perf coverage for rapid-succession detection on a large
 * synthetic per-sender set. Complements backend/tests/fraudDetector.test.js.
 */
import { describe, it, expect } from 'vitest';
import {
  findRapidSuccessionWindow,
  findRapidSuccessionWindowNaive,
  detectBatchFlags,
} from '../backend/src/compliance/rules.js';

function cluster(n, start, intervalMs) {
  return Array.from({ length: n }, (_, i) => ({
    id: `tx-${i}`,
    senderId: 'hot-sender',
    amount: '100',
    createdAt: new Date(start + i * intervalMs),
  }));
}

describe('fraudDetector rapid-succession performance', () => {
  it('sliding-window scan stays linear on 10k txs and matches naive flags', () => {
    const start = Date.UTC(2026, 0, 1);
    // Dense enough that RAPID_SUCCESSION must fire; 10k is well beyond a
    // dashboard page of history for a single sender.
    const txs = cluster(10_000, start, 1000);

    const naiveSubset = findRapidSuccessionWindowNaive(txs.slice(0, 400));
    const slidingSubset = findRapidSuccessionWindow(txs.slice(0, 400));
    expect(slidingSubset).toEqual(naiveSubset);

    const t0 = performance.now();
    const flags = detectBatchFlags(txs);
    const elapsed = performance.now() - t0;

    expect(flags.some((f) => f.type === 'RAPID_SUCCESSION')).toBe(true);
    // O(n) budget: 10k txs must finish well under a second on CI.
    expect(elapsed).toBeLessThan(200);
  });
});
