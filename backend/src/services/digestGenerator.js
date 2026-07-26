/**
 * Generate weekly email digest of transaction activity.
 */
import * as StellarSDK from '@stellar/stellar-sdk';
import * as StellarService from './stellar.js';
import prisma from '../db/client.js';
import { sendNotification } from '../notifications/index.js';
import logger from '../config/logger.js';

const DIGEST_LOOKBACK_DAYS = 7;
const TOP_TRANSACTIONS_COUNT = 5;

/**
 * Get transaction summary for the past N days.
 * @param {string} publicKey - Stellar public key
 * @param {number} days - Number of days to look back
 * @returns {Promise<object>} Transaction summary
 */
async function getTransactionSummary(publicKey, days = DIGEST_LOOKBACK_DAYS) {
  try {
    const server = StellarService.getHorizonServer();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Fetch transactions
    let allTransactions = [];
    let cursor = null;

    for (let i = 0; i < 5; i++) { // Fetch up to 500 transactions (5 pages of 100)
      const builder = server.transactions()
        .forAccount(publicKey)
        .order('desc')
        .limit(100);

      if (cursor) {
        builder.cursor(cursor);
      }

      const response = await builder.call();
      allTransactions = [...allTransactions, ...response.records];

      if (!response.records.length || allTransactions.length > 500) break;

      // Get cursor for next page
      if (response.records.length > 0) {
        cursor = response.records[response.records.length - 1].paging_token;
      }
    }

    // Filter transactions within date range
    const filteredTransactions = allTransactions.filter((tx) => {
      const txDate = new Date(tx.created_at);
      return txDate >= startDate;
    });

    // Analyze transactions
    let totalReceived = 0;
    let totalSent = 0;
    const transactionDetails = [];

    for (const tx of filteredTransactions) {
      if (!tx.successful) continue;

      // Get operations for this transaction
      const opsResponse = await server.operations().forTransaction(tx.hash).call();

      for (const op of opsResponse.records) {
        if (op.type === 'payment') {
          const amount = parseFloat(op.amount);

          if (op.from === publicKey && op.to !== publicKey) {
            totalSent += amount;
          } else if (op.to === publicKey && op.from !== publicKey) {
            totalReceived += amount;
          }

          transactionDetails.push({
            hash: tx.hash,
            date: new Date(tx.created_at),
            type: op.from === publicKey ? 'sent' : 'received',
            amount,
            counterparty: op.from === publicKey ? op.to : op.from,
            asset: op.asset_code || 'XLM',
          });
        }
      }
    }

    // Get current balance
    const account = await server.loadAccount(publicKey);
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
      transactionCount: filteredTransactions.length,
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
 * Called by scheduled job.
 * @returns {Promise<object>} Summary of digests sent
 */
export async function sendScheduledDigests() {
  try {
    // Get current day of week (0 = Sunday)
    const currentDay = new Date().getUTCDay();
    const currentHour = new Date().getUTCHours();

    // Find all users with digest enabled for this day and time (within a 1-hour window)
    const users = await prisma.notificationPreference.findMany({
      where: {
        weeklyDigestEnabled: true,
        weeklyDigestDay: currentDay,
      },
      select: {
        userId: true,
        weeklyDigestTime: true,
      },
    });

    let sent = 0;
    let failed = 0;

    for (const userPref of users) {
      // Check if current hour matches scheduled time (with 1-hour tolerance)
      if (Math.abs(currentHour - userPref.weeklyDigestTime) <= 1) {
        const success = await sendWeeklyDigest(userPref.userId);
        if (success) {
          sent++;
        } else {
          failed++;
        }
      }
    }

    logger.info('digestGenerator.scheduledRun', { sent, failed, currentDay, currentHour });
    return { sent, failed };
  } catch (error) {
    logger.error('digestGenerator.scheduledRunFailed', { error: error.message });
    return { sent: 0, failed: 0 };
  }
}
