/**
 * In-app notification channel.
 * Delivers real-time notifications via WebSocket and persists them to the database.
 */
import prisma from '../../db/client.js';
import { broadcastToAccount } from '../../services/websocket.js';
import logger from '../../config/logger.js';

const MAX_NOTIFICATIONS_PER_USER = 100;

/**
 * Send an in-app notification to a user.
 * Persists to database and broadcasts via WebSocket if user is connected.
 * @param {string} userId
 * @param {string} publicKey - Stellar public key for WebSocket broadcast
 * @param {{ title: string, body: string, type: string, actionUrl?: string, actionRetryParams?: object }} content
 * @returns {Promise<{ success: boolean, id: string }>}
 */
export async function sendInApp(userId, publicKey, { title, body, type, actionUrl, actionRetryParams }) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        channel: 'inApp',
        status: 'sent',
        title,
        body,
        read: false,
        actionUrl,
        actionRetryParams: actionRetryParams || null,
      },
    });

    // Broadcast via WebSocket if publicKey is available
    if (publicKey) {
      broadcastToAccount(publicKey, { type: 'notification', notification });
    }

    logger.info('inApp.sent', { userId, notificationId: notification.id, type });
    return { success: true, id: notification.id };
  } catch (err) {
    logger.error('inApp.send.failed', { userId, type, error: err.message });
    throw err;
  }
}

/**
 * Get in-app notifications for a user from the database.
 * @param {string} userId
 * @param {{ unreadOnly?: boolean, limit?: number }} options
 * @returns {Promise<object[]>}
 */
export async function getInAppNotifications(userId, { unreadOnly = false, limit = 50 } = {}) {
  try {
    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        channel: 'inApp',
        deletedAt: null,
        ...(unreadOnly && { read: false }),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, MAX_NOTIFICATIONS_PER_USER),
    });

    return notifications;
  } catch (err) {
    logger.error('inApp.get.failed', { userId, error: err.message });
    return [];
  }
}

/**
 * Mark one or all in-app notifications as read.
 * @param {string} userId
 * @param {string|'all'} notificationId
 * @returns {Promise<{ updated: number }>}
 */
export async function markAsRead(userId, notificationId) {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        userId,
        channel: 'inApp',
        deletedAt: null,
        ...(notificationId !== 'all' && { id: notificationId }),
      },
      data: { read: true },
    });

    return { updated: result.count };
  } catch (err) {
    logger.error('inApp.markAsRead.failed', { userId, notificationId, error: err.message });
    return { updated: 0 };
  }
}

/**
 * Delete a notification (soft delete).
 * @param {string} userId
 * @param {string} notificationId
 * @returns {Promise<{ deleted: boolean }>}
 */
export async function deleteNotification(userId, notificationId) {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        id: notificationId,
        userId,
        channel: 'inApp',
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    return { deleted: result.count > 0 };
  } catch (err) {
    logger.error('inApp.delete.failed', { userId, notificationId, error: err.message });
    return { deleted: false };
  }
}

/**
 * Clear all read notifications for a user (soft delete).
 * @param {string} userId
 * @returns {Promise<{ cleared: number }>}
 */
export async function clearReadNotifications(userId) {
  try {
    const result = await prisma.notification.updateMany({
      where: {
        userId,
        channel: 'inApp',
        read: true,
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    return { cleared: result.count };
  } catch (err) {
    logger.error('inApp.clearRead.failed', { userId, error: err.message });
    return { cleared: 0 };
  }
}
