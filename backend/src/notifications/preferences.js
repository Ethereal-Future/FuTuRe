/**
 * Notification preferences management.
 * Stores per-user channel preferences and quiet hours.
 */
import prisma from '../db/client.js';
import logger from '../config/logger.js';

// Default preferences applied when none are stored
export const DEFAULT_PREFERENCES = {
  email: true,
  push: true,
  sms: false,
  inApp: true,
  quietHoursStart: 22, // 10 PM
  quietHoursEnd: 7,    // 7 AM
  types: {
    transaction_received: { email: true, push: true, sms: false, inApp: true },
    transaction_sent:     { email: true, push: true, sms: false, inApp: true },
    transaction_failed:   { email: true, push: true, sms: true,  inApp: true },
    login_new_device:     { email: true, push: true, sms: true,  inApp: true },
    account_created:      { email: true, push: false, sms: false, inApp: true },
  },
};

// In-memory store keyed by userId (supplements DB Setting.notificationsOn)
const prefsStore = new Map();

/**
 * Get preferences for a user, merging stored prefs with defaults.
 * @param {string} userId
 * @returns {object}
 */
export async function getPreferences(userId) {
  // Check DB for master notificationsOn flag
  let notificationsOn = true;
  try {
    const setting = await prisma.setting.findUnique({ where: { userId } });
    if (setting) notificationsOn = setting.notificationsOn;
  } catch (err) {
    logger.warn('notifications.preferences.dbRead.failed', { userId, error: err.message });
  }

  const stored = prefsStore.get(userId) ?? {};
  return {
    ...DEFAULT_PREFERENCES,
    ...stored,
    notificationsOn,
    types: { ...DEFAULT_PREFERENCES.types, ...(stored.types ?? {}) },
  };
}

/**
 * Update preferences for a user (partial update).
 * @param {string} userId
 * @param {object} updates
 * @returns {object} merged preferences
 */
export async function updatePreferences(userId, updates) {
  const current = await getPreferences(userId);

  // Persist notificationsOn to DB Setting
  if (typeof updates.notificationsOn === 'boolean') {
    try {
      await prisma.setting.upsert({
        where: { userId },
        update: { notificationsOn: updates.notificationsOn },
        create: { userId, notificationsOn: updates.notificationsOn },
      });
    } catch (err) {
      logger.warn('notifications.preferences.dbWrite.failed', { userId, error: err.message });
    }
  }

  const merged = {
    ...current,
    ...updates,
    types: { ...current.types, ...(updates.types ?? {}) },
  };
  prefsStore.set(userId, merged);
  logger.info('notifications.preferences.updated', { userId });
  return merged;
}

/**
 * Check if a notification should be sent for a given user, type, and channel.
 * Respects quiet hours (UTC).
 * @param {string} userId
 * @param {string} type
 * @param {string} channel
 * @returns {Promise<boolean>}
 */
export async function isChannelEnabled(userId, type, channel) {
  const prefs = await getPreferences(userId);

  if (!prefs.notificationsOn) return false;
  if (!prefs[channel]) return false;

  const typePrefs = prefs.types?.[type];
  if (typePrefs && typeof typePrefs[channel] === 'boolean' && !typePrefs[channel]) return false;

  // Quiet hours check (UTC hour)
  const hour = new Date().getUTCHours();
  const { quietHoursStart, quietHoursEnd } = prefs;
  if (quietHoursStart > quietHoursEnd) {
    // Spans midnight: e.g. 22–7
    if (hour >= quietHoursStart || hour < quietHoursEnd) return false;
  } else if (hour >= quietHoursStart && hour < quietHoursEnd) {
    return false;
  }

  return true;
}
