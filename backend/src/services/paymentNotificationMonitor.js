/**
 * Payment Notification Monitor
 * Streams incoming payments from Horizon and sends push notifications
 *
 * This service monitors Stellar payment streams and triggers web push
 * notifications for incoming payments to subscribed users.
 */
import * as StellarSDK from '@stellar/stellar-sdk';
import { getHorizonServer, isTestnet } from './stellar.js';
import { getSubscriptionByPublicKey, sendWebPush } from '../notifications/webPush.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';

// Track active payment stream monitors per account
const activeMonitors = new Map();

/**
 * Start monitoring a Stellar account for incoming payments
 * @param {string} publicKey - Stellar public key to monitor
 * @returns {void}
 */
export function startPaymentMonitoring(publicKey) {
  if (activeMonitors.has(publicKey)) {
    logger.info('paymentNotificationMonitor.already_monitoring', { publicKey });
    return;
  }

  logger.info('paymentNotificationMonitor.start', { publicKey });
  const monitor = {
    publicKey,
    cursor: 'now',
    closed: false,
  };

  // Start the streaming cursor to 'now' to only get new payments
  const horizonServer = getHorizonServer();
  const stream = horizonServer
    .payments()
    .forAccount(publicKey)
    .cursor('now')
    .stream({
      onmessage: (payment) => handleIncomingPayment(payment, publicKey),
      onerror: (err) => handleStreamError(err, publicKey, stream),
    });

  monitor.stream = stream;
  activeMonitors.set(publicKey, monitor);
}

/**
 * Stop monitoring a Stellar account
 * @param {string} publicKey - Stellar public key
 * @returns {void}
 */
export function stopPaymentMonitoring(publicKey) {
  const monitor = activeMonitors.get(publicKey);
  if (!monitor) return;

  if (monitor.stream) {
    monitor.stream.close();
  }
  monitor.closed = true;
  activeMonitors.delete(publicKey);
  logger.info('paymentNotificationMonitor.stop', { publicKey });
}

/**
 * Handle incoming payment from Horizon stream
 * @param {object} payment - Payment operation from Horizon
 * @param {string} recipientPublicKey - Account being monitored
 */
async function handleIncomingPayment(payment, recipientPublicKey) {
  try {
    // Only process payment operations TO this account
    if (payment.type !== 'payment' || payment.to !== recipientPublicKey) {
      return;
    }

    // Skip payments from self
    if (payment.from === recipientPublicKey) {
      return;
    }

    // Get amount and asset info
    const amount = payment.amount;
    const assetCode = payment.asset_type === 'native' ? 'XLM' : payment.asset_code;
    const sender = payment.from;
    const txHash = payment.transaction_hash;

    logger.info('paymentNotificationMonitor.incoming_payment', {
      recipientPublicKey,
      sender,
      amount,
      assetCode,
      txHash,
    });

    // Get user preferences for this account
    const preferences = await getNotificationPreferences(recipientPublicKey);
    if (!preferences?.incomingPaymentsEnabled) {
      logger.debug('paymentNotificationMonitor.notifications_disabled', { recipientPublicKey });
      return;
    }

    // Get push subscription
    const subscription = getSubscriptionByPublicKey(recipientPublicKey);
    if (!subscription) {
      logger.debug('paymentNotificationMonitor.no_subscription', { recipientPublicKey });
      return;
    }

    // Send push notification
    await sendPaymentNotification(subscription, {
      recipientPublicKey,
      sender,
      amount,
      assetCode,
      txHash,
    });
  } catch (err) {
    logger.error('paymentNotificationMonitor.payment_handler_error', {
      error: err.message,
      recipientPublicKey,
    });
  }
}

/**
 * Send payment notification via web push
 */
async function sendPaymentNotification(subscription, details) {
  const { sender, amount, assetCode, txHash, recipientPublicKey } = details;
  const truncatedSender = `${sender.slice(0, 6)}…${sender.slice(-6)}`;

  const payload = {
    title: `${assetCode} Received`,
    body: `You received ${amount} ${assetCode} from ${truncatedSender}`,
    data: {
      url: `/app#tx=${txHash}`,
      hash: txHash,
      amount,
      assetCode,
      sender: truncatedSender,
      type: 'payment_received',
      timestamp: new Date().toISOString(),
    },
  };

  const result = await sendWebPush(subscription, payload);

  logger.info('paymentNotificationMonitor.notification_sent', {
    recipientPublicKey,
    sender,
    amount,
    assetCode,
    ...result,
  });

  return result;
}

/**
 * Get notification preferences for an account
 */
async function getNotificationPreferences(publicKey) {
  try {
    // Check if user has disabled notifications
    const settings = await prisma.userSettings.findUnique({
      where: { publicKey },
      select: { incomingPaymentsEnabled: true },
    });

    return settings || { incomingPaymentsEnabled: true };
  } catch (err) {
    logger.error('paymentNotificationMonitor.preferences_error', {
      error: err.message,
      publicKey,
    });
    return { incomingPaymentsEnabled: true };
  }
}

/**
 * Handle stream errors and attempt to reconnect
 */
function handleStreamError(err, publicKey, stream) {
  logger.error('paymentNotificationMonitor.stream_error', {
    error: err.message,
    publicKey,
  });

  // Close the stream
  stream?.close?.();
  activeMonitors.delete(publicKey);

  // Attempt reconnect after 5 seconds
  setTimeout(() => {
    logger.info('paymentNotificationMonitor.reconnecting', { publicKey });
    startPaymentMonitoring(publicKey);
  }, 5000);
}

/**
 * Get list of actively monitored accounts
 */
export function getActiveMonitors() {
  return Array.from(activeMonitors.keys());
}

/**
 * Check if an account is being monitored
 */
export function isMonitoring(publicKey) {
  return activeMonitors.has(publicKey) && !activeMonitors.get(publicKey).closed;
}
