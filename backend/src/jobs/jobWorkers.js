/**
 * Job Workers - Processors for each job type
 */
import { createQueue } from './jobQueue.js';

// ─── Queue definitions ────────────────────────────────────────────────────────

export const QUEUES = {
  EMAIL: 'email',
  PAYMENT: 'payment',
  REPORT: 'report',
  NOTIFICATION: 'notification',
  MAINTENANCE: 'maintenance',
};

// ─── Worker processors ────────────────────────────────────────────────────────

async function emailProcessor(job) {
  const { to, subject, body } = job.data;
  job.progress(10);
  // Simulate email sending (replace with real mailer)
  await sleep(50);
  job.progress(100);
  return { sent: true, to, subject, timestamp: new Date().toISOString() };
}

async function paymentProcessor(job) {
  const { sourceSecret, destination, amount, asset } = job.data;
  job.progress(20);
  // Dynamically import stellar service to avoid circular deps
  const { sendPayment } = await import('../services/stellar.js');
  job.progress(50);
  const result = await sendPayment({ sourceSecret, destination, amount, asset });
  job.progress(100);
  return result;
}

async function reportProcessor(job) {
  const { reportType, params } = job.data;
  job.progress(10);
  await sleep(100); // Simulate report generation
  job.progress(80);
  const report = {
    reportType,
    params,
    generatedAt: new Date().toISOString(),
    data: { rows: 0, summary: 'Report generated successfully' },
  };
  job.progress(100);
  return report;
}

async function notificationProcessor(job) {
  const { userId, message, channel } = job.data;
  job.progress(50);
  await sleep(20);
  job.progress(100);
  return { delivered: true, userId, channel, timestamp: new Date().toISOString() };
}

async function maintenanceProcessor(job) {
  const { task } = job.data;
  job.progress(10);
  // Placeholder for maintenance tasks (cleanup, archiving, etc.)
  await sleep(200);
  job.progress(100);
  return { task, completedAt: new Date().toISOString() };
}

// ─── Worker registry ──────────────────────────────────────────────────────────

const PROCESSORS = {
  [QUEUES.EMAIL]: { fn: emailProcessor, concurrency: 5 },
  [QUEUES.PAYMENT]: { fn: paymentProcessor, concurrency: 2 },
  [QUEUES.REPORT]: { fn: reportProcessor, concurrency: 3 },
  [QUEUES.NOTIFICATION]: { fn: notificationProcessor, concurrency: 10 },
  [QUEUES.MAINTENANCE]: { fn: maintenanceProcessor, concurrency: 1 },
};

// ─── Lifecycle ────────────────────────────────────────────────────────────────

const _activeQueues = new Map();

export function startWorkers() {
  for (const [name, { fn, concurrency }] of Object.entries(PROCESSORS)) {
    const queue = createQueue(name);
    queue.process(concurrency, fn);

    queue.on('completed', (job, result) => {
      console.log(`[jobs] ${name}#${job.id} completed`);
    });
    queue.on('failed', (job, err) => {
      console.error(`[jobs] ${name}#${job.id} failed (attempt ${job.attemptsMade ?? job.attempts}): ${err.message}`);
    });
    queue.on('stalled', (job) => {
      console.warn(`[jobs] ${name}#${job.id} stalled`);
    });

    _activeQueues.set(name, queue);
  }
  console.log('[jobs] Workers started for queues:', Object.values(QUEUES).join(', '));
}

export function getWorkerQueues() { return _activeQueues; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
