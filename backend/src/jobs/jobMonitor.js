/**
 * Job Monitor - Metrics, health, and management utilities
 */
import { getAllQueues, getQueue } from './jobQueue.js';
import { listSchedules } from './jobScheduler.js';

/**
 * Aggregate stats across all queues.
 */
export async function getQueueStats() {
  const stats = [];
  for (const { name, queue } of getAllQueues()) {
    try {
      const counts = await queue.getJobCounts();
      stats.push({ queue: name, ...counts });
    } catch (err) {
      stats.push({ queue: name, error: err.message });
    }
  }
  return stats;
}

/**
 * Get detailed info for a single job.
 */
export async function getJobDetails(queueName, jobId) {
  const queue = getQueue(queueName);
  if (!queue) throw new Error(`Queue "${queueName}" not found`);
  const job = await queue.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found in queue "${queueName}"`);
  return serializeJob(job);
}

/**
 * List jobs in a queue filtered by status.
 */
export async function listJobs(queueName, status = 'waiting', start = 0, end = 49) {
  const queue = getQueue(queueName);
  if (!queue) throw new Error(`Queue "${queueName}" not found`);

  let jobs;
  if (typeof queue.getJobs === 'function' && queue.constructor.name === 'InMemoryQueue') {
    jobs = await queue.getJobs([status]);
  } else {
    // Bull API
    jobs = await queue.getJobs([status], start, end);
  }
  return jobs.map(serializeJob);
}

/**
 * Retry a failed job.
 */
export async function retryJob(queueName, jobId) {
  const queue = getQueue(queueName);
  if (!queue) throw new Error(`Queue "${queueName}" not found`);
  const job = await queue.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (typeof job.retry === 'function') {
    await job.retry();
  } else {
    // In-memory fallback: re-queue
    job.status = 'waiting';
    job.attempts = 0;
    job.failedReason = null;
    setTimeout(() => queue._tryProcess(jobId), 0);
  }
  return { retried: true, jobId };
}

/**
 * Remove a job from the queue.
 */
export async function removeJob(queueName, jobId) {
  const queue = getQueue(queueName);
  if (!queue) throw new Error(`Queue "${queueName}" not found`);
  const job = await queue.getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (typeof job.remove === 'function') {
    await job.remove();
  } else {
    queue._jobs?.delete(String(jobId));
  }
  return { removed: true, jobId };
}

/**
 * Pause / resume a queue.
 */
export async function pauseQueue(queueName) {
  const queue = getQueue(queueName);
  if (!queue) throw new Error(`Queue "${queueName}" not found`);
  await queue.pause();
  return { paused: true, queue: queueName };
}

export async function resumeQueue(queueName) {
  const queue = getQueue(queueName);
  if (!queue) throw new Error(`Queue "${queueName}" not found`);
  await queue.resume();
  return { resumed: true, queue: queueName };
}

/**
 * Clean old jobs from a queue.
 */
export async function cleanQueue(queueName, graceMs = 5000, status = 'completed') {
  const queue = getQueue(queueName);
  if (!queue) throw new Error(`Queue "${queueName}" not found`);
  await queue.clean(graceMs, status);
  return { cleaned: true, queue: queueName, status };
}

/**
 * Full system health snapshot.
 */
export async function getSystemHealth() {
  const queueStats = await getQueueStats();
  const schedules = listSchedules();
  const totalJobs = queueStats.reduce((sum, q) => {
    return sum + (q.waiting ?? 0) + (q.active ?? 0) + (q.completed ?? 0) + (q.failed ?? 0);
  }, 0);
  const failedJobs = queueStats.reduce((sum, q) => sum + (q.failed ?? 0), 0);

  return {
    status: failedJobs > 0 ? 'degraded' : 'healthy',
    queues: queueStats,
    schedules,
    totals: { totalJobs, failedJobs },
    timestamp: new Date().toISOString(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serializeJob(job) {
  return {
    id: job.id,
    data: job.data,
    status: job.status ?? (job.finishedOn ? 'completed' : job.processedOn ? 'active' : 'waiting'),
    priority: job.opts?.priority ?? job.priority ?? 0,
    attempts: job.attemptsMade ?? job.attempts ?? 0,
    maxAttempts: job.opts?.attempts ?? job.maxAttempts ?? 3,
    result: job.returnvalue ?? job.result ?? null,
    failedReason: job.failedReason ?? null,
    progress: job._progress ?? 0,
    createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : new Date(job.createdAt).toISOString(),
    processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : job.processedAt ? new Date(job.processedAt).toISOString() : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
  };
}
