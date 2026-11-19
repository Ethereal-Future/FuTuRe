/**
 * Serializes async work per key within this process. Calls sharing a key run
 * one at a time in arrival order; calls with different keys run concurrently.
 */
export class KeyedLock {
  constructor() {
    this.tails = new Map();
  }

  async run(key, fn) {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    const tail = previous.then(() => current);
    this.tails.set(key, tail);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
