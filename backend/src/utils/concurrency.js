/**
 * Run an async worker over a list of items with a bounded number of
 * in-flight operations at any time, instead of one-at-a-time or unbounded.
 * @param {Array<T>} items
 * @param {(item: T) => Promise<void>} worker
 * @param {number} limit - max concurrent workers
 * @returns {Promise<void>}
 */
export async function runWithConcurrency(items, worker, limit) {
  let cursor = 0;

  async function runNext() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  }

  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, runNext));
}
