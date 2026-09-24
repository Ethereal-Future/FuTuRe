import { describe, it, expect } from 'vitest';
import { isStructuring } from '../rules.js';

const HOUR = 60 * 60 * 1000;

function tx(amount, sender = 'user-1', timestamp = Date.now()) {
  return { amount, sender, timestamp };
}

describe('isStructuring', () => {
  it('does not flag normal low-value consumer micro-transactions', () => {
    const now = Date.now();
    const history = [
      tx(5, 'user-1', now - 3 * HOUR),
      tx(15, 'user-1', now - 2 * HOUR),
      tx(25, 'user-1', now - 1 * HOUR),
    ];
    expect(isStructuring(tx(5, 'user-1', now), history)).toBe(false);
  });

  it('does not flag a handful of everyday retail payments', () => {
    const now = Date.now();
    const history = [
      tx(3, 'user-1', now - 5 * HOUR),
      tx(10, 'user-1', now - 4 * HOUR),
      tx(5, 'user-1', now - 3 * HOUR),
      tx(12, 'user-1', now - 2 * HOUR),
      tx(8, 'user-1', now - 1 * HOUR),
    ];
    expect(isStructuring(tx(7, 'user-1', now), history)).toBe(false);
  });

  it('flags a real structuring pattern aggregating near the reporting threshold', () => {
    const now = Date.now();
    const history = [
      tx(3200, 'user-1', now - 12 * HOUR),
      tx(3200, 'user-1', now - 6 * HOUR),
    ];
    expect(isStructuring(tx(3200, 'user-1', now), history)).toBe(true);
  });

  it('does not flag smurfing-range transactions whose cumulative volume is insignificant', () => {
    const now = Date.now();
    const history = [
      tx(500, 'user-1', now - 3 * HOUR),
      tx(500, 'user-1', now - 2 * HOUR),
      tx(500, 'user-1', now - 1 * HOUR),
    ];
    expect(isStructuring(tx(500, 'user-1', now), history)).toBe(false);
  });

  it('ignores transactions from other senders', () => {
    const now = Date.now();
    const history = [
      tx(3200, 'user-2', now - 12 * HOUR),
      tx(3200, 'user-3', now - 6 * HOUR),
    ];
    expect(isStructuring(tx(3200, 'user-1', now), history)).toBe(false);
  });
});
