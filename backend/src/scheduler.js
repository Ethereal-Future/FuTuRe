import logger from './config/logger.js';
import { processActiveStreams } from './services/streaming.js';
import { cleanupExpiredMultiSigTransactions } from './services/multiSig.js';
import { startScheduler as startBackupScheduler } from './backup/manager.js';
import { sendScheduledDigests } from './services/digestGenerator.js';
import { checkAllUserBalances } from './services/lowBalanceMonitor.js';
import { processDueWebhookDeliveries } from './webhooks/dispatcher.js';
import { recordFeeSnapshot, purgeStaleFeeSnapshots } from './services/feeHistory.js';
import { processSep31StatusPolls } from './services/sep31.js';
import { refreshAllRates, RATE_REFRESH_INTERVAL_MS } from './services/exchangeRate.js';
import { syncSanctionsList } from './compliance/sanctionsSync.js';
import { drainAmlAlertDlq } from './compliance/amlMonitor.js';
import { cleanupStaleNotifications } from './notifications/service.js';

let intervals = [];

// Milliseconds until the next 04:00 UTC occurrence.
function msUntilNextUtcHour(hour) {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hour,
    0,
    0,
    0,
  ));
  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

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

  // Multi-sig expiry cleanup (#1287) - transition abandoned pending
  // transactions to 'expired'. Runs every minute (tighter than the 10-minute
  // minimum) since pending envelopes only live for 5 minutes.
  const multiSigInterval = setInterval(async () => {
    try {
      const count = await cleanupExpiredMultiSigTransactions();
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

  // SEP-31 status polling worker - adaptive backoff happens per row in service layer
  const sep31PollInterval = setInterval(async () => {
    try {
      const count = await processSep31StatusPolls();
      if (count > 0) logger.info('scheduler.sep31.processed', { count });
    } catch (err) {
      logger.error('scheduler.sep31.failed', { error: err.message });
    }
  }, 15 * 1000);
  intervals.push(sep31PollInterval);
  // Exchange rate worker – fetch the full price matrix from CoinGecko in one
  // batched request and store it in Redis (`rates:all`) so request paths never
  // call CoinGecko directly. Warm the cache immediately on startup.
  const refreshRates = async () => {
    try {
      await refreshAllRates();
    } catch (err) {
      logger.error('scheduler.exchangeRates.failed', { error: err.message });
    }
  };
  refreshRates();
  const exchangeRateInterval = setInterval(refreshRates, RATE_REFRESH_INTERVAL_MS);
  intervals.push(exchangeRateInterval);

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

  // Fee snapshot worker – persist a real Horizon fee-stats snapshot every
  // 5 minutes so getFeeHistory() can build a chart from genuine data.
  // Take an initial snapshot immediately on startup so the chart is never
  // empty right after deploy.
  (async () => {
    try {
      await recordFeeSnapshot();
      logger.info('scheduler.feeSnapshot.initial');
    } catch (err) {
      logger.error('scheduler.feeSnapshot.initial.failed', { error: err.message });
    }
  })();

  const feeSnapshotInterval = setInterval(async () => {
    try {
      await recordFeeSnapshot();
    } catch (err) {
      logger.error('scheduler.feeSnapshot.failed', { error: err.message });
    }
  }, 5 * 60 * 1000); // Every 5 minutes
  intervals.push(feeSnapshotInterval);

  // Fee snapshot cleanup – purge snapshots older than 30 days, daily at ~midnight.
  const feeSnapshotPurgeInterval = setInterval(async () => {
    try {
      await purgeStaleFeeSnapshots(30);
    } catch (err) {
      logger.error('scheduler.feeSnapshot.purge.failed', { error: err.message });
    }
  }, 24 * 60 * 60 * 1000); // Every 24 hours
  intervals.push(feeSnapshotPurgeInterval);

  // OFAC sanctions list synchronization (#1331) – refresh the SDN list daily
  // at 04:00 UTC so newly designated individuals, vessels, and crypto
  // addresses become active without a redeploy. The first run is scheduled
  // for the next 04:00 UTC boundary; subsequent runs repeat every 24 hours.
  const runSanctionsSync = async () => {
    try {
      const result = await syncSanctionsList();
      logger.info('scheduler.sanctionsSync.synced', { count: result.synced });
    } catch (err) {
      logger.error('scheduler.sanctionsSync.failed', { error: err.message });
    }
  };
  const sanctionsSyncTimeout = setTimeout(() => {
    runSanctionsSync();
    const sanctionsSyncInterval = setInterval(runSanctionsSync, 24 * 60 * 60 * 1000);
    intervals.push(sanctionsSyncInterval);
  }, msUntilNextUtcHour(4));
  intervals.push(sanctionsSyncTimeout);
  // AML alert DLQ retry worker (#1329) - drain failed alert records from the
  // Redis DLQ back into PostgreSQL once database connectivity is restored.
  const amlDlqInterval = setInterval(async () => {
    try {
      const count = await drainAmlAlertDlq();
      if (count > 0) logger.info('scheduler.amlDlq.drained', { count });
    } catch (err) {
      logger.error('scheduler.amlDlq.failed', { error: err.message });
    }
  }, 60 * 1000); // Every minute
  intervals.push(amlDlqInterval);

  // Notification retention cleanup (#1350) - prune read notifications older
  // than 30 days and unread notifications older than 90 days so per-user
  // notification histories stay bounded. Runs daily.
  const notificationCleanupInterval = setInterval(async () => {
    try {
      const count = await cleanupStaleNotifications();
      if (count > 0) logger.info('scheduler.notifications.pruned', { count });
    } catch (err) {
      logger.error('scheduler.notifications.prune.failed', { error: err.message });
    }
  }, 24 * 60 * 60 * 1000); // Every 24 hours
  intervals.push(notificationCleanupInterval);
}

export function stopScheduler() {
  logger.info('scheduler.stop');
  for (const interval of intervals) {
    clearInterval(interval);
    clearTimeout(interval);
  }
  intervals = [];
}
