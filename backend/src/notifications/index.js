/**
 * Notification system public API.
 */
export { sendNotification, notifyTransactionReceived, notifyTransactionSent, notifyTransactionFailed } from './service.js';
export { getPreferences, updatePreferences, isChannelEnabled } from './preferences.js';
export { getDeliveryHistory, getDeliveryStats } from './delivery.js';
export { getInAppNotifications, markAsRead } from './channels/inApp.js';
export { TEMPLATES, getRenderedTemplate } from './templates.js';
