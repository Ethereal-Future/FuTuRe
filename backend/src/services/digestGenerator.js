/**
 * Generate weekly email digest of transaction activity.
 */
import * as StellarSDK from '@stellar/stellar-sdk';
import * as StellarService from './stellar.js';
import { createCircuitBreaker } from './circuitBreaker.js';
import prisma from '../db/client.js';
import { sendNotification } from '../notifications/index.js';
import logger from '../config/logger.js';
import { runWithConcurrency } from '../utils/concurrency.js';
import { recordCustomMetric } from '../monitoring/metrics.js';

const digestBatchBreaker = createCircuitBreaker('Horizon-Batch');

const DIGEST_LOOKBACK_DAYS = 7;
const TOP_TRANSACTIONS_COUNT = 5;
const MAX_PAYMENT_PAGES = 5; // Fetch up to 500 payment ops (5 pages of 100)
const DIGEST_PAGE_SIZE = 200;
const DIGEST_CONCURRENCY = 15;

let digestRunRunning = false;

/**
 * Get transaction summary for the past N days.
 * Uses the account-scoped payments endpoint (one paginated call chain)
 * instead of one operations() lookup per transaction.
 * @param {string} publicKey - Stellar public key
 * @param {number} days - Number of days to look back
 * @returns {Promise<object>} Transaction summary
 */
async function getTransactionSummary(publicKey, days = DIGEST_LOOKBACK_DAYS) {
  try {
    const server = StellarService.getHorizonServer();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Fetch payments directly — bounded by pagination, not transaction volume
    let allPayments = [];
    let cursor = null;

    for (let i = 0; i < MAX_PAYMENT_PAGES; i++) {
      const builder = server.payments()
        .forAccount(publicKey)
        .order('desc')
        .limit(100);

      if (cursor) {
        builder.cursor(cursor);
      }

      const response = await digestBatchBreaker.call(() => builder.call());
      if (!response.records.length) break;

      allPayments = [...allPayments, ...response.records];
      const oldest = response.records[response.records.length - 1];
      cursor = oldest.paging_token;

      // Stop once we've paged past the lookback window
      if (new Date(oldest.created_at) < startDate) break;
    }

    // Analyze payment operations within date range
    let totalReceived = 0;
    let totalSent = 0;
    const transactionDetails = [];
    const seenHashes = new Set();

    for (const payment of allPayments) {
      if (payment.type !== 'payment') continue;
      if (payment.transaction_successful === false) continue;

      const paymentDate = new Date(payment.created_at);
      if (paymentDate < startDate) continue;

      seenHashes.add(payment.transaction_hash);

      const amount = parseFloat(payment.amount);

      if (payment.from === publicKey && payment.to !== publicKey) {
        totalSent += amount;
      } else if (payment.to === publicKey && payment.from !== publicKey) {
        totalReceived += amount;
      }

      transactionDetails.push({
        hash: payment.transaction_hash,
        date: paymentDate,
        type: payment.from === publicKey ? 'sent' : 'received',
        amount,
        counterparty: payment.from === publicKey ? payment.to : payment.from,
        asset: payment.asset_code || 'XLM',
      });
    }

    // Get current balance
    const account = await digestBatchBreaker.call(() => server.loadAccount(publicKey));
    let balance = 0;
    for (const bal of account.balances) {
      if (!bal.asset_code || bal.asset_code === 'XLM') {
        balance = parseFloat(bal.balance);
        break;
      }
    }

    // Sort by amount descending and take top N
    const topTransactions = transactionDetails
      .sort((a, b) => b.amount - a.amount)
      .slice(0, TOP_TRANSACTIONS_COUNT);

    return {
      transactionCount: seenHashes.size,
      totalSent: totalSent.toFixed(7),
      totalReceived: totalReceived.toFixed(7),
      balance: balance.toFixed(7),
      topTransactions,
      startDate: startDate.toISOString(),
      endDate: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('digestGenerator.summaryFailed', { publicKey, error: error.message });
    throw error;
  }
}

/**
 * Send weekly digest to a user.
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} Success flag
 */
export async function sendWeeklyDigest(userId) {
  try {
    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, publicKey: true, email: true },
    });

    if (!user || !user.email) {
      logger.warn('digestGenerator.userNotFound', { userId });
      return false;
    }

    // Get transaction summary
    const summary = await getTransactionSummary(user.publicKey);

    // Format transaction details for display
    const transactionList = summary.topTransactions
      .map((tx) => {
        const abbr = tx.counterparty.slice(0, 6) + '...' + tx.counterparty.slice(-4);
        return `${tx.type === 'sent' ? '→' : '←'} ${tx.amount} ${tx.asset} ${tx.type === 'sent' ? 'to' : 'from'} ${abbr}`;
      })
      .join('\n');

    // Prepare notification data
    const notificationData = {
      transactionCount: summary.transactionCount,
      totalSent: summary.totalSent,
      totalReceived: summary.totalReceived,
      balance: summary.balance,
      transactionList: transactionList || 'No significant transactions',
      startDate: summary.startDate,
      endDate: summary.endDate,
      weekStartDay: new Date(summary.startDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      weekEndDay: new Date(summary.endDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    };

    // Send via email
    await sendNotification({
      userId,
      type: 'weekly_digest',
      data: notificationData,
      email: user.email,
      channels: ['email'],
    });

    logger.info('digestGenerator.sent', { userId });
    return true;
  } catch (error) {
    logger.error('digestGenerator.sendFailed', { userId, error: error.message });
    return false;
  }
}

/**
 * Send digests to all users with digest enabled at their scheduled time.
 * Called by scheduled job. Users are paged through in bounded batches and
 * sent with bounded concurrency, rather than loading everyone into memory
 * and processing sequentially.
 * @returns {Promise<object>} Summary of digests sent
 */
export async function sendScheduledDigests() {
  if (digestRunRunning) {
    logger.warn('digestGenerator.scheduledRunSkipped', { reason: 'already_running' });
    return { sent: 0, failed: 0, skipped: true };
  }

  digestRunRunning = true;
  const startedAt = Date.now();

  try {
    // Get current day of week (0 = Sunday)
    const currentDay = new Date().getUTCDay();
    const currentHour = new Date().getUTCHours();

    let sent = 0;
    let failed = 0;
    let cursor = null;

    for (;;) {
      // Find users with digest enabled for this day (within a 1-hour window of their time)
      const page = await prisma.notificationPreference.findMany({
        where: {
          weeklyDigestEnabled: true,
          weeklyDigestDay: currentDay,
        },
        select: { id: true, userId: true, weeklyDigestTime: true },
        orderBy: { id: 'asc' },
        take: DIGEST_PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });

      if (page.length === 0) break;

      const dueUsers = page.filter((userPref) => Math.abs(currentHour - userPref.weeklyDigestTime) <= 1);

      await runWithConcurrency(
        dueUsers,
        async (userPref) => {
          const success = await sendWeeklyDigest(userPref.userId);
          if (success) {
            sent++;
          } else {
            failed++;
          }
        },
        DIGEST_CONCURRENCY,
      );

      cursor = page[page.length - 1].id;
      if (page.length < DIGEST_PAGE_SIZE) break;
    }

    const durationMs = Date.now() - startedAt;
    recordCustomMetric('digestGenerator.job_duration_ms', durationMs, 'ms');
    recordCustomMetric('digestGenerator.sent', sent, 'count');
    recordCustomMetric('digestGenerator.failed', failed, 'count');

    logger.info('digestGenerator.scheduledRun', { sent, failed, currentDay, currentHour, durationMs });
    return { sent, failed };
  } catch (error) {
    logger.error('digestGenerator.scheduledRunFailed', { error: error.message });
    return { sent: 0, failed: 0 };
  } finally {
    digestRunRunning = false;
  }
}
