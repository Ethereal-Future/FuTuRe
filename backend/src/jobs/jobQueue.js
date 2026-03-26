/**
 * Job Queue - Bull-based queue with in-memory fallback
 * Supports priority, retry, scheduling, and result storage
 */
import { EventEmitter } from 'events';
import { createRequire } from 'module';

// Try to load Bull synchronously. Falls back to in-memory if not installed.
const _require = createRequire(import.meta.url);
let Bull = null;
try {
  Bull = _require('bull');
} catch {
  Bull = null;
}

const REDIS_URL = process.env.REDIS_URL || null;

// ─── In-Memory Queue (fallback) ───────────────────────────────────────────────

class InMemoryQueue extends EventEmitter {
  constructor(name) {
    super();
    this.name = name;
    this._jobs = new Map();
    this._counter = 0;
    this._processors = new Map();
    this._concurrency = 1;
    this._running = 0;
    this._paused = false;
  }

  async add(data, opts = {}) {
    const id = String(++this._counter);
    const job = {
      id,
      name: opts.jobId || id,
      data,
      opts,
      priority: opts.priority ?? 0,
      attempts: 0,
      maxAttempts: opts.attempts ?? 3,
      delay: opts.delay ?? 0,
      status: 'waiting',
      result: null,
      failedReason: null,
      createdAt: Date.now(),
      processedAt: null,
      finishedAt: null,
      progress: 0,
      // Expose progress() method like Bull
      progress: (val) => { job._progress = val; },
    };
    job._progress = 0;
    this._jobs.set(id, job);

    const runAt = Date.now() + job.delay;
    setTimeout(() => this._tryProcess(id), Math.max(0, runAt - Date.now()));
    return job;
  }

  process(concurrencyOrName, concurrencyOrFn, fn) {
    let name = '__default__', concurrency = 1, processor;
    if (typeof concurrencyOrName === 'string') {
      name = concurrencyOrName;
      concurrency = typeof concurrencyOrFn === 'number' ? concurrencyOrFn : 1;
      processor = fn || concurrencyOrFn;
    } else {
      concurrency = typeof concurrencyOrName === 'number' ? concurrencyOrName : 1;
      processor = concurrencyOrFn;
    }
    this._processors.set(name, processor);
    this._concurrency = concurrency;
  }

  async _tryProcess(id) {
    if (this._paused || this._running >= this._concurrency) return;
    const job = this._jobs.get(id);
    if (!job || job.status !== 'waiting') return;

    const processor = this._processors.get('__default__') || this._processors.values().next().value;
    if (!processor) return;

    job.status = 'active';
    job.processedAt = Date.now();
    this._running++;
    this.emit('active', job);

    try {
      job.result = await processor(job);
      job.status = 'completed';
      job.finishedAt = Date.now();
      this.emit('completed', job, job.result);
    } catch (err) {
      job.attempts++;
      job.failedReason = err.message;
      if (job.attempts < job.maxAttempts) {
        job.status = 'waiting';
        const backoff = (job.opts.backoff?.delay ?? 1000) * job.attempts;
        setTimeout(() => this._tryProcess(id), backoff);
        this.emit('failed', job, err);
      } else {
        job.status = 'failed';
        job.finishedAt = Date.now();
        this.emit('failed', job, err);
      }
    } finally {
      this._running--;
    }
  }

  async getJob(id) { return this._jobs.get(String(id)) || null; }
  async getJobs(statuses = []) {
    const all = [...this._jobs.values()];
    return statuses.length ? all.filter(j => statuses.includes(j.status)) : all;
  }
  async getWaiting() { return this.getJobs(['waiting']); }
  async getActive() { return this.getJobs(['active']); }
  async getCompleted() { return this.getJobs(['completed']); }
  async getFailed() { return this.getJobs(['failed']); }
  async getDelayed() { return this.getJobs(['delayed']); }
  async count() { return this._jobs.size; }
  async getJobCounts() {
    const counts = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    for (const j of this._jobs.values()) counts[j.status] = (counts[j.status] || 0) + 1;
    return counts;
  }
  async pause() { this._paused = true; }
  async resume() { this._paused = false; }
  async empty() { this._jobs.clear(); }
  async close() { this._jobs.clear(); }
  async clean(grace, status) {
    const cutoff = Date.now() - grace;
    for (const [id, job] of this._jobs) {
      if (job.status === status && job.finishedAt && job.finishedAt < cutoff) {
        this._jobs.delete(id);
      }
    }
  }
  on(event, fn) { super.on(event, fn); return this; }
}

// ─── Queue Factory ────────────────────────────────────────────────────────────

const _queues = new Map();

export function createQueue(name, opts = {}) {
  if (_queues.has(name)) return _queues.get(name);

  let queue;
  if (Bull && REDIS_URL) {
    try {
      queue = new Bull(name, REDIS_URL, {
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: false,
          removeOnFail: false,
          ...opts.defaultJobOptions,
        },
        ...opts,
      });
    } catch {
      queue = new InMemoryQueue(name);
    }
  } else {
    queue = new InMemoryQueue(name);
  }

  _queues.set(name, queue);
  return queue;
}

export function getQueue(name) { return _queues.get(name) || null; }
export function getAllQueues() { return [..._queues.entries()].map(([name, q]) => ({ name, queue: q })); }

export async function closeAllQueues() {
  for (const { queue } of getAllQueues()) await queue.close();
  _queues.clear();
}

export const isRedisBackend = !!(Bull && REDIS_URL);
