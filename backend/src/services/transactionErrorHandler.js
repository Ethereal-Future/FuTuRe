/**
 * Handle transaction submission failures and dispatch notifications.
 */
import prisma from '../db/client.js';
import { notifyTransactionFailedWithRetry } from '../notifications/index.js';
import { extractStellarErrorCode, getStellarErrorInfo } from '../utils/stellarErrors.js';
import logger from '../config/logger.js';

/**
 * Handle a transaction submission failure by dispatching a notification.
 * @param {string} senderPublicKey - Sender's Stellar public key
 * @param {object} failureDetails - Details about the failure
 * @param {string} failureDetails.amount - Transaction amount
 * @param {string} failureDetails.asset - Asset code
 * @param {Error} failureDetails.error - The error object
 * @param {object} failureDetails.transactionData - Original transaction data for retry
 * @returns {Promise<void>}
 */
export async function handleTransactionFailure(senderPublicKey, {
  amount,
  asset,
  error,
  transactionData,
}) {
  try {
    // Find user by public key
    const user = await prisma.user.findUnique({
      where: { publicKey: senderPublicKey },
      select: { id: true, email: true },
    });

    if (!user) {
      logger.warn('transactionErrorHandler.userNotFound', { senderPublicKey });
      return;
    }

    // Extract error code and get user-friendly message
    const errorCode = extractStellarErrorCode(error);
    const { userMessage, retryable } = getStellarErrorInfo(errorCode);

    // Prepare retry parameters if error is retryable
    const retryParams = retryable
      ? {
        destination: transactionData?.destination,
        amount: String(amount),
        asset,
        memo: transactionData?.memo,
        memoType: transactionData?.memoType,
      }
      : null;

    // Dispatch notification
    await notifyTransactionFailedWithRetry(user.id, {
      amount,
      asset,
      reason: userMessage,
      retryable,
      retryParams,
      email: user.email,
      publicKey: senderPublicKey,
    });

    logger.info('transactionErrorHandler.notificationSent', {
      userId: user.id,
      errorCode,
      retryable,
    });
  } catch (err) {
    logger.error('transactionErrorHandler.failed', {
      senderPublicKey,
      error: err.message,
    });
  }
}

/**
 * Handle batch transaction failures.
 * @param {string} senderPublicKey - Sender's Stellar public key
 * @param {Array} payments - Array of payment objects that failed
 * @param {Error} error - The error object
 * @returns {Promise<void>}
 */
export async function handleBatchTransactionFailure(senderPublicKey, payments, error) {
  try {
    const user = await prisma.user.findUnique({
      where: { publicKey: senderPublicKey },
      select: { id: true, email: true },
    });

    if (!user) {
      logger.warn('transactionErrorHandler.userNotFound', { senderPublicKey });
      return;
    }

    const errorCode = extractStellarErrorCode(error);
    const { userMessage, retryable } = getStellarErrorInfo(errorCode);

    // For batch payments, notify about the total amount
    const totalAmount = payments.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const asset = payments[0]?.assetCode ?? 'XLM';

    await notifyTransactionFailedWithRetry(user.id, {
      amount: totalAmount,
      asset,
      reason: `Batch payment failed: ${userMessage} (${payments.length} payment(s))`,
      retryable,
      retryParams: retryable ? { payments, batchMode: true } : null,
      email: user.email,
      publicKey: senderPublicKey,
    });

    logger.info('transactionErrorHandler.batchNotificationSent', {
      userId: user.id,
      paymentCount: payments.length,
      errorCode,
      retryable,
    });
  } catch (err) {
    logger.error('transactionErrorHandler.batchFailed', {
      senderPublicKey,
      error: err.message,
    });
  }
}
