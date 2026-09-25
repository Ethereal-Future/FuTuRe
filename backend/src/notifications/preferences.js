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
  locale: 'en',
  timezone: 'UTC',
  quietHoursStart: 22, // 10 PM
  quietHoursEnd: 7,    // 7 AM
  weeklyDigestEnabled: false,
  weeklyDigestDay: 1,  // Monday
  weeklyDigestTime: 9, // 9 AM
  lowBalanceAlertEnabled: false,
  lowBalanceThreshold: 10.0,
  lowBalanceAsset: 'XLM',
  types: {
    transaction_received: { email: true, push: true, sms: false, inApp: true },
    transaction_sent:     { email: true, push: true, sms: false, inApp: true },
    transaction_failed:   { email: true, push: true, sms: true,  inApp: true },
    login_new_device:     { email: true, push: true, sms: true,  inApp: true },
    account_created:      { email: true, push: false, sms: false, inApp: true },
  },
};

// Critical security notification types that must bypass quiet hours.
export const CRITICAL_NOTIFICATION_TYPES = new Set([
  'login_new_device',
  'password_reset',
  'aml_freeze',
]);

// In-memory store keyed by userId (supplements DB Setting.notificationsOn)
const prefsStore = new Map();

/**
 * Resolve the user's local hour (0-23) for the given IANA timezone.
 * Falls back to UTC when the timezone is missing or invalid.
 * @param {string} timezone
 * @param {Date} [date]
 * @returns {number}
 */
export function getUserLocalHour(timezone, date = new Date()) {
  const tz = typeof timezone === 'string' && timezone.length > 0 ? timezone : 'UTC';
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      hour: 'numeric',
    }).format(date);
    const hour = parseInt(formatted, 10);
    if (Number.isInteger(hour)) return hour % 24;
  } catch (err) {
    logger.warn('notifications.preferences.timezone.invalid', { timezone: tz, error: err.message });
  }
  return date.getUTCHours();
}

/**
 * Get preferences for a user, merging stored prefs with defaults.
 * @param {string} userId
 * @returns {object}
 */
export async function getPreferences(userId) {
  let notificationsOn = DEFAULT_PREFERENCES.notificationsOn ?? true;
  try {
    const setting = await prisma.setting.findUnique({
      where: { userId },
      select: { notificationsOn: true },
    });
    if (setting) notificationsOn = setting.notificationsOn;
  } catch (err) {
    logger.warn('notifications.preferences.settingRead.failed', { userId, error: err.message });
  }

  try {
    // Fetch from database first
    const notificationPrefs = await prisma.notificationPreference.findUnique({
      where: { userId },
    });

    if (notificationPrefs) {
      return {
        ...DEFAULT_PREFERENCES,
        notificationsOn,
        locale: notificationPrefs.locale ?? 'en',
        timezone: notificationPrefs.timezone ?? 'UTC',
        email: notificationPrefs.emailEnabled,
        push: notificationPrefs.pushEnabled,
        sms: notificationPrefs.smsEnabled,
        inApp: notificationPrefs.inAppEnabled,
        emailEnabled: notificationPrefs.emailEnabled,
        pushEnabled: notificationPrefs.pushEnabled,
        smsEnabled: notificationPrefs.smsEnabled,
        inAppEnabled: notificationPrefs.inAppEnabled,
        quietHoursStart: notificationPrefs.quietHoursStart,
        quietHoursEnd: notificationPrefs.quietHoursEnd,
        weeklyDigestEnabled: notificationPrefs.weeklyDigestEnabled,
        weeklyDigestDay: notificationPrefs.weeklyDigestDay,
        weeklyDigestTime: notificationPrefs.weeklyDigestTime,
        lowBalanceAlertEnabled: notificationPrefs.lowBalanceAlertEnabled,
        lowBalanceThreshold: notificationPrefs.lowBalanceThreshold,
        lowBalanceAsset: notificationPrefs.lowBalanceAsset,
        typeOverrides: notificationPrefs.typeOverrides || {},
      };
    }
  } catch (err) {
    logger.warn('notifications.preferences.dbRead.failed', { userId, error: err.message });
  }

  // Check in-memory store for backward compatibility
  const stored = prefsStore.get(userId) ?? {};
  return {
    ...DEFAULT_PREFERENCES,
    notificationsOn,
    ...stored,
    types: { ...DEFAULT_PREFERENCES.types, ...(stored.types ?? {}) },
  };
}

/**
 * Update preferences for a user (partial update).
 * @param {string} userId
 * @param {object} updates
 * @returns {object} merged preferences
 * @throws {Error} if preferences are invalid
 */
export async function updatePreferences(userId, updates) {
  // Validate quiet hours if provided
  if (typeof updates.quietHoursStart !== 'undefined') {
    if (!Number.isInteger(updates.quietHoursStart) || updates.quietHoursStart < 0 || updates.quietHoursStart > 23) {
      throw new Error('quietHoursStart must be an integer between 0 and 23');
    }
  }
  if (typeof updates.quietHoursEnd !== 'undefined') {
    if (!Number.isInteger(updates.quietHoursEnd) || updates.quietHoursEnd < 0 || updates.quietHoursEnd > 23) {
      throw new Error('quietHoursEnd must be an integer between 0 and 23');
    }
  }

  // Validate timezone if provided
  if (typeof updates.timezone !== 'undefined') {
    if (typeof updates.timezone !== 'string' || updates.timezone.length === 0) {
      throw new Error('timezone must be a non-empty IANA timezone string');
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: updates.timezone });
    } catch (err) {
      throw new Error(`timezone must be a valid IANA timezone: ${updates.timezone}`);
    }
  }

  // Validate weekly digest day if provided
  if (typeof updates.weeklyDigestDay !== 'undefined') {
    if (!Number.isInteger(updates.weeklyDigestDay) || updates.weeklyDigestDay < 0 || updates.weeklyDigestDay > 6) {
      throw new Error('weeklyDigestDay must be an integer between 0 and 6');
    }
  }

  // Validate weekly digest time if provided
  if (typeof updates.weeklyDigestTime !== 'undefined') {
    if (!Number.isInteger(updates.weeklyDigestTime) || updates.weeklyDigestTime < 0 || updates.weeklyDigestTime > 23) {
      throw new Error('weeklyDigestTime must be an integer between 0 and 23');
    }
  }

  // Validate low balance threshold if provided
  if (typeof updates.lowBalanceThreshold !== 'undefined') {
    const threshold = parseFloat(updates.lowBalanceThreshold);
    if (Number.isNaN(threshold) || threshold < 0) {
      throw new Error('lowBalanceThreshold must be a positive number');
    }
  }

  if (typeof updates.notificationsOn !== 'undefined') {
    try {
      await prisma.setting.upsert({
        where: { userId },
        update: { notificationsOn: updates.notificationsOn },
        create: { userId, notificationsOn: updates.notificationsOn },
      });
    } catch (err) {
      logger.error('notifications.preferences.settingWrite.failed', { userId, error: err.message });
      throw err;
    }
  }

  try {
    // Upsert notification preferences to database
    const updateData = {};

    if (typeof updates.email !== 'undefined') updateData.emailEnabled = updates.email;
    if (typeof updates.push !== 'undefined') updateData.pushEnabled = updates.push;
    if (typeof updates.sms !== 'undefined') updateData.smsEnabled = updates.sms;
    if (typeof updates.inApp !== 'undefined') updateData.inAppEnabled = updates.inApp;
    if (typeof updates.locale !== 'undefined') updateData.locale = updates.locale;
    if (typeof updates.timezone !== 'undefined') updateData.timezone = updates.timezone;
    if (typeof updates.quietHoursStart !== 'undefined') updateData.quietHoursStart = updates.quietHoursStart;
    if (typeof updates.quietHoursEnd !== 'undefined') updateData.quietHoursEnd = updates.quietHoursEnd;
    if (typeof updates.weeklyDigestEnabled !== 'undefined') updateData.weeklyDigestEnabled = updates.weeklyDigestEnabled;
    if (typeof updates.weeklyDigestDay !== 'undefined') updateData.weeklyDigestDay = updates.weeklyDigestDay;
    if (typeof updates.weeklyDigestTime !== 'undefined') updateData.weeklyDigestTime = updates.weeklyDigestTime;
    if (typeof updates.lowBalanceAlertEnabled !== 'undefined') updateData.lowBalanceAlertEnabled = updates.lowBalanceAlertEnabled;
    if (typeof updates.lowBalanceThreshold !== 'undefined') updateData.lowBalanceThreshold = parseFloat(updates.lowBalanceThreshold);
    if (typeof updates.lowBalanceAsset !== 'undefined') updateData.lowBalanceAsset = updates.lowBalanceAsset;

    await prisma.notificationPreference.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        ...updateData,
      },
    });
  } catch (err) {
    logger.error('notifications.preferences.dbWrite.failed', { userId, error: err.message });
    throw err;
  }

  const current = await getPreferences(userId);
  prefsStore.set(userId, current);
  logger.info('notifications.preferences.updated', { userId });
  return current;
}

/**
 * Check if a notification should be sent for a given user, type, and channel.
 * Respects quiet hours evaluated in the user's configured local timezone.
 * Critical security notifications bypass quiet hours.
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

  // Critical security notifications bypass quiet hours entirely.
  if (CRITICAL_NOTIFICATION_TYPES.has(type)) return true;

  // Quiet hours check evaluated in the user's local timezone.
  if (typeof prefs.quietHoursStart === 'number' && typeof prefs.quietHoursEnd === 'number') {
    const currentHour = getUserLocalHour(prefs.timezone);
    const start = prefs.quietHoursStart;
    const end = prefs.quietHoursEnd;

    if (start === end) {
      // Degenerate window: treat as no quiet hours.
    } else if (start < end) {
      // Same-day window, e.g. 09 -> 17
      if (currentHour >= start && currentHour < end) return false;
    } else {
      // Overnight window, e.g. 22 -> 07
      if (currentHour >= start || currentHour < end) return false;
    }
  }

  return true;
}
