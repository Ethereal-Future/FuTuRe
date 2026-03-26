/**
 * Job Scheduler - Cron-based recurring jobs
 */
import { createQueue } from './jobQueue.js';
import { QUEUES } from './jobWorkers.js';

// Simple cron-like scheduler using setInterval (no external dep required)
// Supports: every N ms, or cron string via basic pattern matching

const _schedules = new Map();

/**
 * Schedule a recurring job.
 * @param {string} name - Unique schedule name
 * @param {string} queueName - Target queue
 * @param {object} data - Job data
 * @param {object} opts - { every: ms } or { cron: 'cron expression' }
 * @param {object} jobOpts - Bull job options (priority, attempts, etc.)
 */
export function scheduleJob(name, queueName, data, opts = {}, jobOpts = {}) {
  if (_schedules.has(name)) {
    console.warn(`[scheduler] Schedule "${name}" already exists, skipping`);
    return;
  }

  const queue = createQueue(queueName);

  if (opts.every) {
    const handle = setInterval(async () => {
      try {
        await queue.add(data, { jobId: `${name}-${Date.now()}`, ...jobOpts });
      } catch (err) {
        console.error(`[scheduler] Failed to enqueue "${name}":`, err.message);
      }
    }, opts.every);

    _schedules.set(name, { handle, type: 'interval', queueName, opts });
    console.log(`[scheduler] "${name}" scheduled every ${opts.every}ms on queue "${queueName}"`);
  } else if (opts.cron) {
    // Use Bull's built-in repeat if available, otherwise fall back to interval approximation
    queue.add(data, { repeat: { cron: opts.cron }, jobId: name, ...jobOpts })
      .catch(err => {
        // Bull repeat not available (in-memory fallback) — approximate with 1-min interval
        console.warn(`[scheduler] Cron not supported in fallback mode, using 60s interval for "${name}"`);
        const handle = setInterval(async () => {
          await queue.add(data, { jobId: `${name}-${Date.now()}`, ...jobOpts });
        }, 60_000);
        _schedules.set(name, { handle, type: 'interval-fallback', queueName, opts });
      });
    _schedules.set(name, { handle: null, type: 'cron', queueName, opts });
    console.log(`[scheduler] "${name}" scheduled with cron "${opts.cron}" on queue "${queueName}"`);
  }
}

export function cancelSchedule(name) {
  const entry = _schedules.get(name);
  if (!entry) return false;
  if (entry.handle) clearInterval(entry.handle);
  _schedules.delete(name);
  console.log(`[scheduler] Cancelled schedule "${name}"`);
  return true;
}

export function listSchedules() {
  return [..._schedules.entries()].map(([name, s]) => ({
    name,
    type: s.type,
    queueName: s.queueName,
    opts: s.opts,
  }));
}

export function stopAllSchedules() {
  for (const [name] of _schedules) cancelSchedule(name);
}

// ─── Built-in system schedules ────────────────────────────────────────────────

export function startSystemSchedules() {
  // Clean up old completed/failed jobs every hour
  scheduleJob(
    'system:cleanup',
    QUEUES.MAINTENANCE,
    { task: 'cleanup-old-jobs' },
    { every: 60 * 60 * 1000 },
    { priority: 10, attempts: 1 }
  );

  // Daily report generation at midnight (approximated as 24h interval)
  scheduleJob(
    'system:daily-report',
    QUEUES.REPORT,
    { reportType: 'daily-summary', params: {} },
    { every: 24 * 60 * 60 * 1000 },
    { priority: 5, attempts: 2 }
  );
}
