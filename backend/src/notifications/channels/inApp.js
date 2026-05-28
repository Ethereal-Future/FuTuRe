/**
 * In-app notification channel.
 * Delivers real-time notifications via WebSocket and stores them in memory.
 */
import { broadcastToAccount } from '../../services/websocket.js';
import logger from '../../config/logger.js';

// In-memory store: userId -> notification[]
const inAppStore = new Map();
const MAX_PER_USER = 100;

/**
 * Send an in-app notification to a user.
 * Broadcasts via WebSocket if the user is connected, and stores for later retrieval.
 * @param {string} userId
 * @param {string} publicKey - Stellar public key for WebSocket broadcast
 * @param {{ title: string, body: string, type: string }} content
 * @returns {{ success: boolean, id: string }}
 */
export function sendInApp(userId, publicKey, { title, body, type }) {
  const notification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    userId,
    type,
    title,
    body,
    read: false,
    createdAt: new Date().toISOString(),
  };

  // Store notification
  if (!inAppStore.has(userId)) inAppStore.set(userId, []);
  const userNotifs = inAppStore.get(userId);
  userNotifs.unshift(notification);
  // Cap to MAX_PER_USER
  if (userNotifs.length > MAX_PER_USER) userNotifs.splice(MAX_PER_USER);

  // Broadcast via WebSocket if publicKey is available
  if (publicKey) {
    broadcastToAccount(publicKey, { type: 'notification', notification });
  }

  logger.info('inApp.sent', { userId, notificationId: notification.id, type });
  return { success: true, id: notification.id };
}

/**
 * Get stored in-app notifications for a user.
 * @param {string} userId
 * @param {{ unreadOnly?: boolean }} options
 * @returns {object[]}
 */
export function getInAppNotifications(userId, { unreadOnly = false } = {}) {
  const notifs = inAppStore.get(userId) ?? [];
  return unreadOnly ? notifs.filter(n => !n.read) : notifs;
}

/**
 * Mark one or all notifications as read.
 * @param {string} userId
 * @param {string|'all'} notificationId
 * @returns {{ updated: number }}
 */
export function markAsRead(userId, notificationId) {
  const notifs = inAppStore.get(userId) ?? [];
  let updated = 0;
  for (const n of notifs) {
    if (notificationId === 'all' || n.id === notificationId) {
      n.read = true;
      updated++;
    }
  }
  return { updated };
}
