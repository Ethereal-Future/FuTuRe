import logger from './config/logger.js';
import { processActiveStreams } from './services/streaming.js';
import { expireStaleTransactions } from './services/multiSig.js';
import { startScheduler as startBackupScheduler } from './backup/manager.js';
import { sendScheduledDigests } from './services/digestGenerator.js';
import { checkAllUserBalances } from './services/lowBalanceMonitor.js';
import { processDueWebhookDeliveries } from './webhooks/dispatcher.js';

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

  // Webhook delivery retry worker - check every 10 seconds so pending
  // retries survive a process restart instead of living in a setTimeout.
  const webhookDeliveryInterval = setInterval(async () => {
    try {
      const count = await processDueWebhookDeliveries();
      if (count > 0) logger.info('scheduler.webhookDelivery.processed', { count });
    } catch (err) {
      logger.error('scheduler.webhookDelivery.failed', { error: err.message });
    }
  }, 10 * 1000);
  intervals.push(webhookDeliveryInterval);

  // Backup scheduler
  try {
    startBackupScheduler();
  } catch (err) {
    logger.error('scheduler.backup.failed', { error: err.message });
  }

  // Weekly digest sender - check every hour
  const digestInterval = setInterval(async () => {
    try {
      const result = await sendScheduledDigests();
      if (result.sent > 0) {
        logger.info('scheduler.digest.sent', { count: result.sent });
      }
      if (result.failed > 0) {
        logger.warn('scheduler.digest.failed', { count: result.failed });
      }
    } catch (err) {
      logger.error('scheduler.digest.error', { error: err.message });
    }
  }, 60 * 60 * 1000); // Every hour
  intervals.push(digestInterval);

  // Low balance monitor - check every 30 minutes
  const balanceCheckInterval = setInterval(async () => {
    try {
      const result = await checkAllUserBalances();
      if (result.alertsSent > 0) {
        logger.info('scheduler.balance.alerts', { count: result.alertsSent });
      }
      if (result.checksFailed > 0) {
        logger.warn('scheduler.balance.checksFailed', { count: result.checksFailed });
      }
    } catch (err) {
      logger.error('scheduler.balance.error', { error: err.message });
    }
  }, 30 * 60 * 1000); // Every 30 minutes
  intervals.push(balanceCheckInterval);
}

export function stopScheduler() {
  logger.info('scheduler.stop');
  for (const interval of intervals) {
    clearInterval(interval);
  }
  intervals = [];
}
