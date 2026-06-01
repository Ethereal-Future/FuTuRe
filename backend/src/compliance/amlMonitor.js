import prisma from '../db/client.js';
import logger from '../config/logger.js';

// Configurable thresholds via environment variables
const STRUCTURING_COUNT_THRESHOLD = parseInt(process.env.AML_STRUCTURING_COUNT_THRESHOLD || '3', 10);
const STRUCTURING_AMOUNT_THRESHOLD = parseFloat(process.env.AML_STRUCTURING_AMOUNT_THRESHOLD || '1000');
const VELOCITY_AMOUNT_THRESHOLD = parseFloat(process.env.AML_VELOCITY_AMOUNT_THRESHOLD || '10000');

/**
 * Checks a transaction against AML rules and creates alerts if triggered.
 * @param {Object} transaction - The transaction object containing userId, amount, etc.
 */
export async function checkTransaction(transaction) {
  const { userId, amount, id: transactionId } = transaction;
  if (!userId || !amount) {
    return;
  }

  const parsedAmount = parseFloat(amount);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    // Fetch user's transactions in the last 24 hours
    const recentTransactions = await prisma.transaction.findMany({
      where: {
        userId,
        createdAt: {
          gte: oneDayAgo,
        },
      },
    });

    // Include the current transaction if it's not already in the list
    const allTransactions = [...recentTransactions];
    if (transactionId && !allTransactions.some(tx => tx.id === transactionId)) {
      allTransactions.push(transaction);
    } else if (!transactionId) {
      allTransactions.push(transaction);
    }

    // 1. Structuring detection: flag if a user sends >3 transactions in 24h each below $1000
    const belowThresholdTx = allTransactions.filter(tx => parseFloat(tx.amount) < STRUCTURING_AMOUNT_THRESHOLD);
    if (belowThresholdTx.length > STRUCTURING_COUNT_THRESHOLD) {
      await prisma.aMLAlert.create({
        data: { 
          userId,
          rule: 'STRUCTURING',
          severity: 'HIGH',
          description: `User sent ${belowThresholdTx.length} transactions below $${STRUCTURING_AMOUNT_THRESHOLD} within 24 hours.`,
          status: 'PENDING',
        },
      });
      logger.warn(`AML Alert: Structuring detected for user ${userId}`);
    }

    // 2. Velocity check: flag if total sent in 24h exceeds $10,000
    const totalSent24h = allTransactions.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
    if (totalSent24h > VELOCITY_AMOUNT_THRESHOLD) {
      await prisma.aMLAlert.create({
        data: { 
          userId,
          rule: 'VELOCITY',
          severity: 'CRITICAL',
          description: `User total sent amount in 24 hours ($${totalSent24h}) exceeded the threshold of $${VELOCITY_AMOUNT_THRESHOLD}.`,
          status: 'PENDING',
        },
      });
      logger.warn(`AML Alert: Velocity threshold exceeded for user ${userId}`);
    }
  } catch (error) {
    logger.error('Error running AML checks:', error);
  }
}

export const amlMonitor = {
  checkTransaction,
};

export default amlMonitor;