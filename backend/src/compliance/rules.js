/**
 * Shared fraud / AML rule definitions.
 *
 * Both the live payment-path monitor (`amlMonitor`) and the analytics
 * dashboard (`fraudDetector`) MUST import thresholds and detection helpers
 * from this module. Do not re-declare these constants elsewhere.
 *
 * Flag / rule IDs
 * ---------------
 * LARGE_TX          — single transaction ≥ AML_LARGE_TX_THRESHOLD
 * STRUCTURING       — ≥ AML_STRUCTURING_COUNT prior txs each below
 *                     AML_STRUCTURING_THRESHOLD in the last 24 h, and the
 *                     current tx is also below that ceiling (smurfing).
 * NEAR_THRESHOLD    — single transaction in [AML_NEAR_THRESHOLD_LOW, LARGE_TX)
 *                     (just-below-reporting-threshold). Distinct from STRUCTURING.
 * VELOCITY          — sender's 24 h send total (history + current) exceeds
 *                     AML_VELOCITY_LIMIT
 * RAPID_SUCCESSION  — ≥ AML_RAPID_TX_COUNT txs from the same sender within
 *                     AML_RAPID_TX_WINDOW_MS
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Hard upper bound on the number of distinct sender states retained by a
 * streaming analyzer. Prevents unbounded heap growth (OOM) under continuous
 * streams with many unique senders. Least-recently-used senders are evicted
 * once this capacity is exceeded.
 */
export const MAX_TRACKED_SENDERS = parseInt(
  process.env.AML_MAX_TRACKED_SENDERS ?? '50000',
  10
);

export const THRESHOLDS = Object.freeze({
  LARGE_TX: parseFloat(process.env.AML_LARGE_TX_THRESHOLD ?? '10000'),
  STRUCTURING: parseFloat(process.env.AML_STRUCTURING_THRESHOLD ?? '1000'),
  STRUCTURING_COUNT: parseInt(process.env.AML_STRUCTURING_COUNT ?? '3', 10),
  STRUCTURING_LOWER: parseFloat(process.env.AML_STRUCTURING_LOWER ?? '100'),
  STRUCTURING_VOLUME_RATIO: parseFloat(process.env.AML_STRUCTURING_VOLUME_RATIO ?? '0.85'),
  VELOCITY_LIMIT: parseFloat(process.env.AML_VELOCITY_LIMIT ?? '10000'),
  WINDOW_MS: DAY_MS,
  RAPID_TX_WINDOW_MS: parseInt(process.env.AML_RAPID_TX_WINDOW_MS ?? String(HOUR_MS), 10),
  RAPID_TX_COUNT: parseInt(process.env.AML_RAPID_TX_COUNT ?? '5', 10),
  NEAR_THRESHOLD_LOW: parseFloat(process.env.AML_NEAR_THRESHOLD_LOW ?? '9000'),
});

export function txAmount(tx) {
  return Number(tx.amount);
}

export function txTime(tx) {
  if (tx.createdAt instanceof Date) return tx.createdAt.getTime();
  return new Date(tx.createdAt).getTime();
}

function sameSenderInWindow(tx, history, windowMs) {
  const t = txTime(tx);
  const windowStart = t - windowMs;
  return history.filter(
    (h) => h.senderId === tx.senderId && txTime(h) >= windowStart && txTime(h) <= t
  );
}

export function isLargeTx(tx) {
  return txAmount(tx) >= THRESHOLDS.LARGE_TX;
}

export function isNearThreshold(tx) {
  const amount = txAmount(tx);
  return amount >= THRESHOLDS.NEAR_THRESHOLD_LOW && amount < THRESHOLDS.LARGE_TX;
}

/**
 * Structuring (smurfing) detection.
 *
 * Real structuring is breaking a large reporting amount (e.g. the $10,000
 * FinCEN threshold) into multiple smaller transactions that aggregate close
 * to or over that threshold. We therefore require BOTH:
 *   1. enough smurfing-range transactions in the window (each in
 *      [STRUCTURING_LOWER, LARGE_TX)), and
 *   2. a cumulative volume near the reporting threshold
 *      (≥ LARGE_TX * STRUCTURING_VOLUME_RATIO).
 *
 * Ordinary low-value consumer activity (coffee, lunch, small transfers) is
 * excluded by the lower bound and never reaches the cumulative volume gate.
 */
export function isStructuring(tx, history = []) {
  const amount = txAmount(tx);
  if (amount >= THRESHOLDS.LARGE_TX) return false;

  const recent = sameSenderInWindow(tx, history, THRESHOLDS.WINDOW_MS).filter(
    (h) => {
      const a = txAmount(h);
      return a >= THRESHOLDS.STRUCTURING_LOWER && a < THRESHOLDS.LARGE_TX;
    }
  );

  const inSmurfRange =
    amount >= THRESHOLDS.STRUCTURING_LOWER && amount < THRESHOLDS.LARGE_TX;
  const count = recent.length + (inSmurfRange ? 1 : 0);
  if (count < THRESHOLDS.STRUCTURING_COUNT) return false;

  const cumulativeSum =
    recent.reduce((sum, h) => sum + txAmount(h), 0) + (inSmurfRange ? amount : 0);

  return cumulativeSum >= THRESHOLDS.LARGE_TX * THRESHOLDS.STRUCTURING_VOLUME_RATIO;
}

export function isVelocityExceeded(tx, history = []) {
  const prior = sameSenderInWindow(tx, history, THRESHOLDS.WINDOW_MS).reduce(
    (sum, h) => sum + txAmount(h),
    0
  );
  return prior + txAmount(tx) > THRESHOLDS.VELOCITY_LIMIT;
}

export function isRapidSuccession(tx, history = []) {
  const recent = sameSenderInWindow(tx, history, THRESHOLDS.RAPID_TX_WINDOW_MS);
  return recent.length + 1 >= THRESHOLDS.RAPID_TX_COUNT;
}

/**
 * First rapid-succession window in a sender's transactions (already sorted
 * by createdAt ascending). Two-pointer / sliding window: O(n).
 *
 * Semantically identical to scanning, for each tx i, the count of txs in
 * [t_i, t_i + RAPID_TX_WINDOW_MS] and flagging the first window whose count
 * is ≥ RAPID_TX_COUNT.
 */
export function findRapidSuccessionWindow(sortedTxs) {
  const n = sortedTxs.length;
  const needed = THRESHOLDS.RAPID_TX_COUNT;
  const windowMs = THRESHOLDS.RAPID_TX_WINDOW_MS;
  let right = 0;

  for (let left = 0; left < n; left++) {
    const windowEnd = txTime(sortedTxs[left]) + windowMs;
    while (right < n && txTime(sortedTxs[right]) <= windowEnd) {
      right++;
    }
    const count = right - left;
    if (count >= needed) {
      return {
        count,
        windowStart: sortedTxs[left].createdAt,
        txId: sortedTxs[left].id,
      };
    }
  }

  return null;
}

/**
 * Naive O(n²) rapid-succession scan kept for correctness-parity tests only.
 * Do not use on the request path.
 */
export function findRapidSuccessionWindowNaive(sortedTxs) {
  const needed = THRESHOLDS.RAPID_TX_COUNT;
  const windowMs = THRESHOLDS.RAPID_TX_WINDOW_MS;

  for (let i = 0; i < sortedTxs.length; i++) {
    const start = txTime(sortedTxs[i]);
    const windowEnd = start + windowMs;
    let count = 0;
    for (let j = i; j < sortedTxs.length; j++) {
      const t = txTime(sortedTxs[j]);
      if (t > windowEnd) break;
      if (t >= start) count++;
    }
    if (count >= needed) {
      return {
        count,
        windowStart: sortedTxs[i].createdAt,
        txId: sortedTxs[i].id,
      };
    }
  }

  return null;
}

function pushFlag(flags, type, severity, senderId, extra) {
  flags.push({ type, severity, senderId, ...extra });
}

function evictHead(deque, cutoff, onEvict) {
  while (deque.length && txTime(deque[0]) < cutoff) {
    const gone = deque.shift();
    if (onEvict) onEvict(gone);
  }
}

/**
 * Bounded LRU map for per-sender streaming state.
 *
 * Backed by a native `Map` (insertion-ordered), which lets us evict the
 * least-recently-used entry in O(1) by deleting and re-inserting the key on
 * access. This guarantees a hard upper bound on the number of retained sender
 * states, preventing unbounded heap growth / OOM under continuous streams
 * with many unique senders.
 */
class LruMap {
  constructor(max) {
    this.max = max > 0 ? max : 1;
    this.map = new Map();
  }

  get size() {
    return this.map.size;
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    // Refresh recency: move to the most-recently-used position.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    return this;
  }

  delete(key) {
    return this.map.delete(key);
  }
}

/**
 * Incremental per-sender analyzer. Feed transactions in createdAt order
 * (globally or per sender). Each sender keeps only the last WINDOW_MS of
 * txs plus a 1h rapid window, with running sum/counts — O(1) amortized
 * per transaction (O(n) overall).
 *
 * Sender state is held in a bounded LRU map (see MAX_TRACKED_SENDERS) and
 * idle senders whose windows have fully aged out are dropped eagerly, so
 * memory stays flat under continuous streams.
 */
export function createStreamAnalyzer() {
  const states = new LruMap(MAX_TRACKED_SENDERS);
  const flags = [];

  function stateFor(senderId) {
    let state = states.get(senderId);
    if (!state) {
      state = {
        day: [],
        hour: [],
        sum: 0,
        smallCount: 0,
        smurfSum: 0,
        rapidFlagged: false,
      };
      states.set(senderId, state);
    }
    return state;
  }

  function inSmurfRange(amount) {
    return amount >= THRESHOLDS.STRUCTURING_LOWER && amount < THRESHOLDS.LARGE_TX;
  }

  function process(tx) {
    const senderId = tx.senderId;
    const state = stateFor(senderId);
    const t = txTime(tx);
    const amount = txAmount(tx);

    evictHead(state.day, t - THRESHOLDS.WINDOW_MS, (gone) => {
      const goneAmount = txAmount(gone);
      state.sum -= goneAmount;
      if (inSmurfRange(goneAmount)) {
        state.smallCount -= 1;
        state.smurfSum -= goneAmount;
      }
    });
    evictHead(state.hour, t - THRESHOLDS.RAPID_TX_WINDOW_MS);

    if (isLargeTx(tx)) {
      pushFlag(flags, 'LARGE_TX', 'HIGH', senderId, { txId: tx.id, amount });
    }

    if (isNearThreshold(tx)) {
      pushFlag(flags, 'NEAR_THRESHOLD', 'HIGH', senderId, { txId: tx.id, amount });
    }

    if (inSmurfRange(amount)) {
      const count = state.smallCount + 1;
      const cumulativeSum = state.smurfSum + amount;
      if (
        count >= THRESHOLDS.STRUCTURING_COUNT &&
        cumulativeSum >= THRESHOLDS.LARGE_TX * THRESHOLDS.STRUCTURING_VOLUME_RATIO
      ) {
        pushFlag(flags, 'STRUCTURING', 'HIGH', senderId, {
          txId: tx.id,
          amount,
          count,
          cumulativeSum,
        });
      }
    }

    if (state.sum + amount > THRESHOLDS.VELOCITY_LIMIT) {
      pushFlag(flags, 'VELOCITY', 'MEDIUM', senderId, {
        txId: tx.id,
        amount,
        total: state.sum + amount,
      });
    }

    if (!state.rapidFlagged && state.hour.length + 1 >= THRESHOLDS.RAPID_TX_COUNT) {
      state.rapidFlagged = true;
      pushFlag(flags, 'RAPID_SUCCESSION', 'MEDIUM', senderId, {
        txId: tx.id,
        count: state.hour.length + 1,
      });
    }

    state.day.push(tx);
    state.hour.push(tx);
    state.sum += amount;
    if (inSmurfRange(amount)) {
      state.smallCount += 1;
      state.smurfSum += amount;
    }

    // Eagerly drop senders with no active window transactions so idle
    // states do not linger in memory indefinitely.
    if (state.day.length === 0 && state.hour.length === 0) {
      states.delete(senderId);
    }

    return state;
  }

  return {
    process,
    flags,
    get trackedSenders() {
      return states.size;
    },
  };
}
