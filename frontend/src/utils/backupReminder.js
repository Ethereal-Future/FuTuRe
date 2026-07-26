/**
 * Local (device-scoped) tracking for the "create a fresh backup" reminder.
 * Persisted to localStorage rather than the backend, since it only concerns
 * this browser's nudge state, not account data.
 */

const STORAGE_KEY = 'future_backup_reminder_v1';
const DEFAULT_THRESHOLD = 10;
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeState(patch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readState(), ...patch }));
  } catch {
    // ignore quota errors
  }
}

export function getBackupReminderThreshold() {
  const { threshold } = readState();
  return Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_THRESHOLD;
}

export function setBackupReminderThreshold(threshold) {
  const n = Number(threshold);
  writeState({ threshold: Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD });
}

export function getLastBackupInfo() {
  const { lastBackupTimestamp = null, lastBackupTransactionCount = 0 } = readState();
  return { lastBackupTimestamp, lastBackupTransactionCount };
}

/** Call whenever a backup is created or successfully verified. */
export function recordBackupEvent(transactionCount = 0) {
  writeState({
    lastBackupTimestamp: new Date().toISOString(),
    lastBackupTransactionCount: transactionCount,
    snoozedUntil: null,
  });
}

export function snoozeBackupReminder() {
  writeState({ snoozedUntil: Date.now() + SNOOZE_MS });
}

export function isBackupReminderSnoozed() {
  const { snoozedUntil } = readState();
  return typeof snoozedUntil === 'number' && Date.now() < snoozedUntil;
}
