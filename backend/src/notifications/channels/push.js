/**
 * Push notification channel.
 * Delegates to the existing mobile PushNotifications service.
 * In production, swap _send() in mobile/notifications.js to call FCM/APNs.
 */
import pushNotifications from '../../mobile/notifications.js';
import logger from '../../config/logger.js';

/**
 * Send a push notification to all registered devices for a user.
 * @param {string} userId
 * @param {{ title: string, body: string, data?: object }} content
 * @returns {Promise<{ success: boolean, sent: number }>}
 */
export async function sendPush(userId, { title, body, data = {} }) {
  try {
    const result = await pushNotifications.notify(userId, { title, body, data });
    logger.info('push.sent', { userId, title, sent: result.sent });
    return { success: true, sent: result.sent };
  } catch (err) {
    logger.error('push.send.failed', { userId, title, error: err.message });
    return { success: false, sent: 0, error: err.message };
  }
}
