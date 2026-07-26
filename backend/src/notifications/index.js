/**
 * Notification system public API.
 */
export { sendNotification, notifyTransactionReceived, notifyTransactionSent, notifyTransactionFailed, notifyTransactionFailedWithRetry } from './service.js';
export { getPreferences, updatePreferences, isChannelEnabled } from './preferences.js';
export { getDeliveryHistory, getDeliveryStats } from './delivery.js';
export { getInAppNotifications, markAsRead, deleteNotification, clearReadNotifications } from './channels/inApp.js';
export { TEMPLATES, getRenderedTemplate } from './templates.js';
