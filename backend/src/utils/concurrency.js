/**
 * Bounded concurrency primitives for load testing and other async workloads.
 *
 * - `createSemaphore(limit)` bounds the number of in-flight operations.
 * - `createRateLimiter(ratePerSec)` paces operation starts using a token bucket.
 * - `runWithConcurrency(items, worker, limit)` runs a worker over a list of
 *   items with a bounded number of in-flight operations at any time.
 */

/**
 * Create a counting semaphore that bounds the number of concurrent holders.
 *
 * @param {number} limit - maximum number of concurrent acquisitions (>= 1)
 * @returns {{
 *   acquire: () => Promise<void>,
 *   release: () => void,
 *   run: <T>(fn: () => Promise<T> | T) => Promise<T>,
 *   readonly limit: number,
 *   readonly active: number,
 *   readonly pending: number,
 * }}
 */
export function createSemaphore(limit) {
  const max = Math.max(1, Math.floor(Number(limit)) || 1);
  let active = 0;
  const waiters = [];

  function acquire() {
    if (active < max) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiters.push(resolve);
    });
  }

  function release() {
    if (waiters.length > 0) {
      // Hand the slot directly to the next waiter without dropping `active`.
      const next = waiters.shift();
      next();
      return;
    }
    if (active > 0) {
      active -= 1;
    }
  }

  async function run(fn) {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return {
    acquire,
    release,
    run,
    get limit() {
      return max;
    },
    get active() {
      return active;
    },
    get pending() {
      return waiters.length;
    },
  };
}

/**
 * Create a token-bucket rate limiter that paces operation starts.
 *
 * Tokens refill continuously at `ratePerSec`. `acquire()` resolves as soon as
 * a token is available, allowing bursts up to the bucket capacity.
 *
 * @param {number} ratePerSec - tokens added per second (must be > 0)
 * @param {number} [burst] - bucket capacity; defaults to `ratePerSec`
 * @returns {{
 *   acquire: () => Promise<void>,
 *   readonly ratePerSec: number,
 *   readonly burst: number,
 * }}
 */
export function createRateLimiter(ratePerSec, burst) {
  const rate = Number(ratePerSec);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new RangeError('createRateLimiter: ratePerSec must be a positive number');
  }

  const capacity = Math.max(
    1,
    Math.floor(Number.isFinite(Number(burst)) && Number(burst) > 0 ? Number(burst) : rate),
  );

  let tokens = capacity;
  let lastRefill = Date.now();
  const waiters = [];

  function refill() {
    const now = Date.now();
    const elapsed = (now - lastRefill) / 1000;
    if (elapsed > 0) {
      tokens = Math.min(capacity, tokens + elapsed * rate);
      lastRefill = now;
    }
  }

  function schedule() {
    refill();

    while (waiters.length > 0 && tokens >= 1) {
      tokens -= 1;
      const resolve = waiters.shift();
      resolve();
    }

    if (waiters.length > 0) {
      const deficit = 1 - tokens;
      const delayMs = Math.max(1, Math.ceil((deficit / rate) * 1000));
      const timer = setTimeout(schedule, delayMs);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    }
  }

  function acquire() {
    refill();
    if (tokens >= 1 && waiters.length === 0) {
      tokens -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiters.push(resolve);
      schedule();
    });
  }

  return {
    acquire,
    get ratePerSec() {
      return rate;
    },
    get burst() {
      return capacity;
    },
  };
}

/**
 * Run an async worker over a list of items with a bounded number of
 * in-flight operations at any time, instead of one-at-a-time or unbounded.
 * @param {Array<T>} items
 * @param {(item: T) => Promise<void>} worker
 * @param {number} limit - max concurrent workers
 * @returns {Promise<void>}
 */
export async function runWithConcurrency(items, worker, limit) {
  if (!Array.isArray(items) || items.length === 0) {
    return;
  }

  const semaphore = createSemaphore(limit);
  let cursor = 0;

  async function runNext() {
    while (cursor < items.length) {
      const index = cursor++;
      await semaphore.run(() => worker(items[index]));
    }
  }

  const poolSize = Math.max(1, Math.min(Math.floor(Number(limit)) || 1, items.length));
  await Promise.all(Array.from({ length: poolSize }, runNext));
}