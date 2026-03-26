import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createQueue, getQueue, getAllQueues, closeAllQueues } from '../src/jobs/jobQueue.js';
import { getQueueStats, getJobDetails, listJobs, retryJob, removeJob, pauseQueue, resumeQueue, cleanQueue, getSystemHealth } from '../src/jobs/jobMonitor.js';
import { scheduleJob, cancelSchedule, listSchedules, stopAllSchedules } from '../src/jobs/jobScheduler.js';

const Q = 'test-queue';

/** Poll until predicate is true or timeout */
async function waitFor(fn, timeout = 3000, interval = 20) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('waitFor timed out');
}

beforeEach(() => closeAllQueues());
afterEach(() => { stopAllSchedules(); closeAllQueues(); });

// ─── Queue ────────────────────────────────────────────────────────────────────

describe('InMemoryQueue', () => {
  it('creates and reuses queues', () => {
    const q1 = createQueue(Q);
    const q2 = createQueue(Q);
    expect(q1).toBe(q2);
  });

  it('enqueues and processes a job', async () => {
    const queue = createQueue(Q);
    queue.process(1, async (job) => job.data.value * 2);

    const job = await queue.add({ value: 7 });
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'completed');

    const stored = await queue.getJob(job.id);
    expect(stored.result).toBe(14);
  });

  it('retries on failure then succeeds', async () => {
    const queue = createQueue(Q);
    let calls = 0;
    queue.process(1, async () => {
      calls++;
      if (calls < 2) throw new Error('transient');
      return 'ok';
    });

    const job = await queue.add({}, { attempts: 3, backoff: { delay: 10 } });
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'completed');
    expect(calls).toBe(2);
  });

  it('marks job as failed after max attempts', async () => {
    const queue = createQueue(Q);
    queue.process(1, async () => { throw new Error('always fails'); });

    const job = await queue.add({}, { attempts: 2, backoff: { delay: 10 } });
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'failed');

    const stored = await queue.getJob(job.id);
    expect(stored.failedReason).toBe('always fails');
  });

  it('respects delay option', async () => {
    const queue = createQueue(Q);
    const times = [];
    queue.process(1, async () => { times.push(Date.now()); });

    const before = Date.now();
    const job = await queue.add({}, { delay: 80 });
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'completed');
    expect(times[0] - before).toBeGreaterThanOrEqual(70);
  });

  it('pause prevents processing', async () => {
    const queue = createQueue(Q);
    const processed = [];
    queue.process(1, async (job) => { processed.push(job.id); });

    await queue.pause();
    await queue.add({});
    await new Promise(r => setTimeout(r, 60));
    expect(processed).toHaveLength(0);
    await queue.resume();
  });

  it('getJobCounts returns correct counts', async () => {
    const queue = createQueue(Q);
    queue.process(1, async () => 'done');
    const job = await queue.add({});
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'completed');
    const counts = await queue.getJobCounts();
    expect(counts.completed).toBeGreaterThanOrEqual(1);
  });

  it('clean removes old completed jobs', async () => {
    const queue = createQueue(Q);
    queue.process(1, async () => 'done');
    const job = await queue.add({});
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'completed');

    await queue.clean(0, 'completed');
    const completed = await queue.getCompleted();
    expect(completed).toHaveLength(0);
  });
});

// ─── Monitor ──────────────────────────────────────────────────────────────────

describe('jobMonitor', () => {
  it('getQueueStats returns stats for all queues', async () => {
    createQueue('q-a');
    createQueue('q-b');
    const stats = await getQueueStats();
    expect(stats.length).toBeGreaterThanOrEqual(2);
    expect(stats[0]).toHaveProperty('queue');
    expect(stats[0]).toHaveProperty('waiting');
  });

  it('getJobDetails returns serialized job', async () => {
    const queue = createQueue(Q);
    queue.process(1, async () => 42);
    const job = await queue.add({ x: 1 });
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'completed');

    const details = await getJobDetails(Q, job.id);
    expect(details.id).toBe(job.id);
    expect(details.result).toBe(42);
    expect(details).toHaveProperty('createdAt');
  });

  it('listJobs filters by status', async () => {
    const queue = createQueue(Q);
    queue.process(1, async () => 'done');
    const job = await queue.add({});
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'completed');

    const completed = await listJobs(Q, 'completed');
    expect(completed.length).toBeGreaterThanOrEqual(1);
    expect(completed[0].status).toBe('completed');
  });

  it('retryJob re-queues a failed job', async () => {
    const queue = createQueue(Q);
    let calls = 0;
    queue.process(1, async () => { if (++calls === 1) throw new Error('fail'); return 'ok'; });

    const job = await queue.add({}, { attempts: 1, backoff: { delay: 10 } });
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'failed');

    await retryJob(Q, job.id);
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'completed');
    expect(calls).toBe(2);
  });

  it('removeJob deletes the job', async () => {
    const queue = createQueue(Q);
    queue.process(1, async () => {});
    const job = await queue.add({});
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'completed');

    await removeJob(Q, job.id);
    expect(await queue.getJob(job.id)).toBeNull();
  });

  it('pauseQueue and resumeQueue work', async () => {
    createQueue(Q);
    expect((await pauseQueue(Q)).paused).toBe(true);
    expect((await resumeQueue(Q)).resumed).toBe(true);
  });

  it('cleanQueue removes old jobs', async () => {
    const queue = createQueue(Q);
    queue.process(1, async () => 'done');
    const job = await queue.add({});
    await waitFor(async () => (await queue.getJob(job.id))?.status === 'completed');

    const result = await cleanQueue(Q, 0, 'completed');
    expect(result.cleaned).toBe(true);
  });

  it('getSystemHealth returns status and queues', async () => {
    createQueue(Q);
    const health = await getSystemHealth();
    expect(health).toHaveProperty('status');
    expect(health).toHaveProperty('queues');
    expect(health).toHaveProperty('totals');
    expect(health).toHaveProperty('timestamp');
  });

  it('throws error for unknown queue', async () => {
    await expect(getJobDetails('nonexistent', '1')).rejects.toThrow('not found');
  });
});

// ─── Scheduler ────────────────────────────────────────────────────────────────

describe('jobScheduler', () => {
  it('schedules and cancels an interval job', () => {
    createQueue(Q);
    scheduleJob('test-sched', Q, { task: 'ping' }, { every: 50_000 });
    expect(listSchedules().find(s => s.name === 'test-sched')).toBeTruthy();

    expect(cancelSchedule('test-sched')).toBe(true);
    expect(listSchedules().find(s => s.name === 'test-sched')).toBeUndefined();
  });

  it('does not duplicate schedules with same name', () => {
    createQueue(Q);
    scheduleJob('dup', Q, {}, { every: 99_999 });
    scheduleJob('dup', Q, {}, { every: 99_999 });
    expect(listSchedules().filter(s => s.name === 'dup')).toHaveLength(1);
    cancelSchedule('dup');
  });

  it('enqueues a job when interval fires', async () => {
    const queue = createQueue(Q);
    const received = [];
    queue.process(1, async (job) => { received.push(job.data); });

    scheduleJob('fast', Q, { ping: true }, { every: 30 });
    await new Promise(r => setTimeout(r, 120));
    cancelSchedule('fast');

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].ping).toBe(true);
  });
});
