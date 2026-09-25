import { describe, it, expect } from 'vitest';
import { createStreamAnalyzer } from './rules.js';

describe('createStreamAnalyzer', () => {
  it('flags rapid transactions from the same sender', () => {
    const analyzer = createStreamAnalyzer();
    const base = Date.now();

    for (let i = 0; i < 5; i += 1) {
      analyzer.process({
        senderId: 'sender-1',
        amount: 100,
        timestamp: base + i * 1000,
      });
    }

    expect(analyzer.flags.length).toBeGreaterThan(0);
  });

  it('evicts sender state once all window transactions age out', () => {
    const analyzer = createStreamAnalyzer();
    const base = Date.now();

    analyzer.process({ senderId: 'sender-1', amount: 100, timestamp: base });
    expect(analyzer.trackedSenders()).toBe(1);

    // Advance well past the 24h window so the sender's queues drain.
    analyzer.process({
      senderId: 'sender-2',
      amount: 100,
      timestamp: base + 25 * 60 * 60 * 1000,
    });

    expect(analyzer.trackedSenders()).toBe(1);
  });

  it('bounds tracked senders under a large stream of distinct senders', () => {
    const analyzer = createStreamAnalyzer();
    const base = Date.now();
    const total = 100000;

    for (let i = 0; i < total; i += 1) {
      analyzer.process({
        senderId: `sender-${i}`,
        amount: 100,
        timestamp: base + i,
      });
    }

    expect(analyzer.trackedSenders()).toBeLessThanOrEqual(analyzer.maxTrackedSenders());
    expect(analyzer.trackedSenders()).toBeLessThan(total);
  });
});
