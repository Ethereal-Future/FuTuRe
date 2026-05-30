import logger from './config/logger.js';
import { processActiveStreams } from './services/streaming.js';
import { expireStaleTransactions } from './services/multiSig.js';
import { startScheduler as startBackupScheduler } from './backup/manager.js';

let intervals = [];

export async function startScheduler() {
  logger.info('scheduler.start');

  // Streaming payment worker - check every minute
  const streamingInterval = setInterval(async () => {
    try {
      await processActiveStreams();
    } catch (err) {
      logger.error('scheduler.streaming.failed', { error: err.message });
    }
  }, 60 * 1000);
  intervals.push(streamingInterval);

  // Multi-sig expiry worker - check every minute
  const multiSigInterval = setInterval(async () => {
    try {
      const count = await expireStaleTransactions();
      if (count > 0) logger.info('scheduler.multisig.expired', { count });
    } catch (err) {
      logger.error('scheduler.multisig.failed', { error: err.message });
    }
  }, 60 * 1000);
  intervals.push(multiSigInterval);

  // Backup scheduler
  try {
    startBackupScheduler();
  } catch (err) {
    logger.error('scheduler.backup.failed', { error: err.message });
  }
}

export function stopScheduler() {
  logger.info('scheduler.stop');
  for (const interval of intervals) {
    clearInterval(interval);
  }
  intervals = [];
}
