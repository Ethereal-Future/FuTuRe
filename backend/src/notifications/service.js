/**
 * Core notification service.
 * Orchestrates template rendering, preference checks, channel dispatch, and delivery tracking.
 */
import logger from '../config/logger.js';
import { getRenderedTemplate } from './templates.js';
import { isChannelEnabled, getPreferences } from './preferences.js';
import { recordDelivery } from './delivery.js';
import { sendEmail } from './channels/email.js';
import { sendPush } from './channels/push.js';
import { sendSms } from './channels/sms.js';
import { sendInApp } from './channels/inApp.js';

const CHANNELS = ['email', 'push', 'sms', 'inApp'];

/**
 * Send a notification to a user across all enabled channels.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.type - Template key (e.g. 'transaction_received')
 * @param {object} params.data - Template interpolation data
 * @param {string} [params.email] - User's email address (for email channel)
 * @param {string} [params.phone] - User's phone number in E.164 (for SMS channel)
 * @param {string} [params.publicKey] - Stellar public key (for in-app WebSocket broadcast)
 * @param {string[]} [params.channels] - Override which channels to attempt
 * @returns {Promise<object>} Results per channel
 */
export async function sendNotification({ userId, type, data = {}, email, phone, publicKey, channels = CHANNELS }) {
  const results = {};

  await Promise.all(
    channels.map(async (channel) => {
      const enabled = await isChannelEnabled(userId, type, channel);
      if (!enabled) {
        results[channel] = { skipped: true };
        recordDelivery({ userId, type, channel, status: 'skipped' });
        return;
      }

      const content = getRenderedTemplate(type, channel, data);
      if (!content) {
        results[channel] = { skipped: true, reason: 'no_template' };
        recordDelivery({ userId, type, channel, status: 'skipped' });
        return;
      }

      try {
        let result;
        switch (channel) {
          case 'email':
            if (!email) { results[channel] = { skipped: true, reason: 'no_email' }; return; }
            result = await sendEmail(email, content);
            break;
          case 'push':
            result = await sendPush(userId, content);
            break;
          case 'sms':
            if (!phone) { results[channel] = { skipped: true, reason: 'no_phone' }; return; }
            result = await sendSms(phone, content);
            break;
          case 'inApp':
            result = sendInApp(userId, publicKey, { ...content, type });
            break;
          default:
            results[channel] = { skipped: true, reason: 'unknown_channel' };
            return;
        }

        results[channel] = result;
        recordDelivery({ userId, type, channel, status: result.success ? 'sent' : 'failed', error: result.error });
      } catch (err) {
        logger.error('notification.channel.error', { userId, type, channel, error: err.message });
        results[channel] = { success: false, error: err.message };
        recordDelivery({ userId, type, channel, status: 'failed', error: err.message });
      }
    })
  );

  logger.info('notification.dispatched', { userId, type, channels: Object.keys(results) });
  return results;
}

/**
 * Convenience: notify a user about a received transaction.
 */
export async function notifyTransactionReceived(userId, { amount, asset, senderPublicKey, txHash, email, phone, publicKey }) {
  return sendNotification({
    userId, type: 'transaction_received',
    data: { amount: String(amount), asset, senderPublicKey, txHash },
    email, phone, publicKey,
  });
}

/**
 * Convenience: notify a user about a sent transaction.
 */
export async function notifyTransactionSent(userId, { amount, asset, recipientPublicKey, txHash, email, phone, publicKey }) {
  return sendNotification({
    userId, type: 'transaction_sent',
    data: { amount: String(amount), asset, recipientPublicKey, txHash },
    email, phone, publicKey,
  });
}

/**
 * Convenience: notify a user about a failed transaction.
 */
export async function notifyTransactionFailed(userId, { amount, asset, reason, email, phone, publicKey }) {
  return sendNotification({
    userId, type: 'transaction_failed',
    data: { amount: String(amount), asset, reason },
    email, phone, publicKey,
  });
}
