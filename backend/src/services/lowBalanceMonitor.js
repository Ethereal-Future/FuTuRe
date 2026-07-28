/**
 * Monitor user account balances and send alerts when below threshold.
 */
import * as StellarService from './stellar.js';
import prisma from '../db/client.js';
import { sendNotification } from '../notifications/index.js';
import logger from '../config/logger.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import { recordCustomMetric } from '../monitoring/metrics.js';

const ALERT_RECHECK_INTERVAL_HOURS = 24; // Re-alert every 24 hours if still below threshold
const BALANCE_CHECK_PAGE_SIZE = 200;
const BALANCE_CHECK_CONCURRENCY = 15;

let balanceCheckRunning = false;

/**
 * Check if a balance alert should be sent based on suppression rules.
 * @param {string} userId - User ID
 * @param {number} currentBalance - Current account balance
 * @returns {Promise<boolean>} Whether alert should be sent
 */
async function shouldSendAlert(userId, currentBalance) {
  try {
    const prefs = await prisma.notificationPreference.findUnique({
      where: { userId },
      select: {
        lastLowBalanceAlertAt: true,
        lastLowBalanceAlertLevel: true,
      },
    });

    if (!prefs) return true;

    // Check if we've already sent an alert in the last interval
    if (prefs.lastLowBalanceAlertAt) {
      const timeSinceLastAlert = Date.now() - new Date(prefs.lastLowBalanceAlertAt).getTime();
      const hoursSinceLastAlert = timeSinceLastAlert / (1000 * 60 * 60);

      // If less than interval has passed and balance hasn't changed significantly
      if (hoursSinceLastAlert < ALERT_RECHECK_INTERVAL_HOURS) {
        // Only re-alert if balance dropped significantly (e.g., more than 20%)
        const lastLevel = prefs.lastLowBalanceAlertLevel?.toNumber?.() || 0;
        const percentageDrop = ((lastLevel - currentBalance) / lastLevel) * 100;

        if (percentageDrop < 20) {
          return false;
        }
      }
    }

    return true;
  } catch (error) {
    logger.error('lowBalanceMonitor.shouldSendAlertCheckFailed', { userId, error: error.message });
    return true; // Default to sending alert on error
  }
}

/**
 * Check balance for a user and send alert if below threshold.
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} Whether alert was sent
 */
export async function checkAndAlertBalance(userId) {
  try {
    // Get user and preferences
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { publicKey: true, email: true },
    });

    const prefs = await prisma.notificationPreference.findUnique({
      where: { userId },
      select: {
        lowBalanceAlertEnabled: true,
        lowBalanceThreshold: true,
        lowBalanceAsset: true,
      },
    });

    if (!user || !prefs?.lowBalanceAlertEnabled) {
      return false;
    }

    // Get current balance
    const balance = await StellarService.getBalance(user.publicKey);
    const nativeBalance = balance.balances.find((b) => b.asset_code === 'native' || !b.asset_code);
    const currentBalance = nativeBalance ? parseFloat(nativeBalance.balance) : 0;

    // Check if below threshold
    const threshold = prefs.lowBalanceThreshold?.toNumber?.() || 10.0;
    const asset = prefs.lowBalanceAsset || 'XLM';

    if (currentBalance >= threshold) {
      return false;
    }

    // Check if alert should be suppressed
    const shouldAlert = await shouldSendAlert(userId, currentBalance);
    if (!shouldAlert) {
      logger.debug('lowBalanceMonitor.alertSuppressed', { userId, currentBalance, threshold });
      return false;
    }

    // Send alert
    await sendNotification({
      userId,
      type: 'low_balance_alert',
      data: {
        currentBalance: currentBalance.toFixed(7),
        threshold: threshold.toFixed(7),
        asset,
      },
      email: user.email,
      channels: ['email', 'push', 'inApp'],
    });

    // Update last alert timestamp and level
    await prisma.notificationPreference.update({
      where: { userId },
      data: {
        lastLowBalanceAlertAt: new Date(),
        lastLowBalanceAlertLevel: currentBalance,
      },
    });

    logger.info('lowBalanceMonitor.alertSent', { userId, currentBalance, threshold });
    return true;
  } catch (error) {
    logger.error('lowBalanceMonitor.checkFailed', { userId, error: error.message });
    return false;
  }
}

/**
 * Check balances for all users with low balance alerts enabled.
 * Called by scheduled job. Users are paged through in bounded batches and
 * checked with bounded concurrency, rather than loading everyone into
 * memory and processing sequentially.
 * @returns {Promise<object>} Summary of alerts sent
 */
export async function checkAllUserBalances() {
  if (balanceCheckRunning) {
    logger.warn('lowBalanceMonitor.batchCheckSkipped', { reason: 'already_running' });
    return { alertsSent: 0, checksFailed: 0, usersChecked: 0, skipped: true };
  }

  balanceCheckRunning = true;
  const startedAt = Date.now();

  try {
    let alertsSent = 0;
    let checksFailed = 0;
    let usersChecked = 0;
    let cursor = null;

    for (;;) {
      const page = await prisma.notificationPreference.findMany({
        where: { lowBalanceAlertEnabled: true },
        select: { id: true, userId: true },
        orderBy: { id: 'asc' },
        take: BALANCE_CHECK_PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (page.length === 0) break;

      await runWithConcurrency(
        page,
        async (userPref) => {
          try {
            const sent = await checkAndAlertBalance(userPref.userId);
            if (sent) alertsSent++;
          } catch (error) {
            checksFailed++;
            logger.error('lowBalanceMonitor.checkFailed', { userId: userPref.userId, error: error.message });
          }
        },
        BALANCE_CHECK_CONCURRENCY,
      );

      usersChecked += page.length;
      cursor = page[page.length - 1].id;

      if (page.length < BALANCE_CHECK_PAGE_SIZE) break;
    }

    const durationMs = Date.now() - startedAt;
    recordCustomMetric('lowBalanceMonitor.job_duration_ms', durationMs, 'ms');
    recordCustomMetric('lowBalanceMonitor.users_checked', usersChecked, 'count');
    recordCustomMetric('lowBalanceMonitor.checks_failed', checksFailed, 'count');

    logger.info('lowBalanceMonitor.batchCheck', { alertsSent, checksFailed, usersChecked, durationMs });
    return { alertsSent, checksFailed, usersChecked };
  } catch (error) {
    logger.error('lowBalanceMonitor.batchCheckFailed', { error: error.message });
    return { alertsSent: 0, checksFailed: 0, usersChecked: 0 };
  } finally {
    balanceCheckRunning = false;
  }
}

/**
 * Monitor balance after a transaction.
 * This can be called from transaction handlers to immediately check balance.
 * @param {string} senderPublicKey - Sender's Stellar public key
 * @returns {Promise<void>}
 */
export async function monitorBalanceAfterTransaction(senderPublicKey) {
  try {
    const user = await prisma.user.findUnique({
      where: { publicKey: senderPublicKey },
      select: { id: true },
    });

    if (user) {
      await checkAndAlertBalance(user.id);
    }
  } catch (error) {
    logger.error('lowBalanceMonitor.postTransactionCheckFailed', { senderPublicKey, error: error.message });
  }
}
