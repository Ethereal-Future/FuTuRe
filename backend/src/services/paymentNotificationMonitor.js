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

// Reconnect backoff state per account (exponential with jitter + circuit breaker)
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 60000;
const CIRCUIT_FAILURE_THRESHOLD = 10;
const CIRCUIT_COOLDOWN_MS = 5 * 60 * 1000;
const reconnectState = new Map();

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
      onmessage: (payment) => {
        reconnectState.delete(publicKey); // healthy stream resets backoff
        handleIncomingPayment(payment, publicKey);
      },
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
  const state = reconnectState.get(publicKey);
  if (state?.timer) clearTimeout(state.timer);
  reconnectState.delete(publicKey);
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
    const user = await prisma.user.findUnique({
      where: { publicKey },
      select: { id: true },
    });
    if (!user) return { incomingPaymentsEnabled: true };

    const settings = await prisma.setting.findUnique({
      where: { userId: user.id },
      select: { notificationsOn: true },
    });

    return { incomingPaymentsEnabled: settings?.notificationsOn ?? true };
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
  // Close the stream
  stream?.close?.();
  activeMonitors.delete(publicKey);

  const state = reconnectState.get(publicKey) || { attempts: 0, timer: null };
  if (state.timer) return; // reconnect already scheduled
  state.attempts += 1;

  let delay;
  if (state.attempts > CIRCUIT_FAILURE_THRESHOLD) {
    // Circuit open: pause before trying again, then half-open with a single attempt
    delay = CIRCUIT_COOLDOWN_MS;
    if (state.attempts === CIRCUIT_FAILURE_THRESHOLD + 1) {
      logger.error('paymentNotificationMonitor.circuit_open', { publicKey, cooldownMs: delay });
    }
    state.attempts = CIRCUIT_FAILURE_THRESHOLD;
  } else {
    const exp = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (state.attempts - 1));
    delay = Math.floor(exp / 2 + Math.random() * (exp / 2)); // jitter
    // Log only on first failure and at power-of-two attempts to avoid log spam
    if ((state.attempts & (state.attempts - 1)) === 0) {
      logger.error('paymentNotificationMonitor.stream_error', {
        error: err?.message,
        publicKey,
        attempt: state.attempts,
        retryInMs: delay,
      });
    }
  }

  state.timer = setTimeout(() => {
    state.timer = null;
    logger.debug('paymentNotificationMonitor.reconnecting', { publicKey, attempt: state.attempts });
    startPaymentMonitoring(publicKey);
  }, delay);
  state.timer.unref?.();
  reconnectState.set(publicKey, state);
}

/**
 * Get list of actively monitored accounts.
 * @returns {string[]} Public keys currently being monitored
 */
export function getActiveMonitors() {
  return Array.from(activeMonitors.keys());
}

/**
 * Check if an account is being monitored.
 * @param {string} publicKey - Stellar public key
 * @returns {boolean} True if a monitor is active and not closed
 */
export function isMonitoring(publicKey) {
  return activeMonitors.has(publicKey) && !activeMonitors.get(publicKey).closed;
}
