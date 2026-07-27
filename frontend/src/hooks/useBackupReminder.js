import { useCallback } from 'react';
import {
  getBackupReminderThreshold,
  getLastBackupInfo,
  isBackupReminderSnoozed,
  snoozeBackupReminder,
} from '../utils/backupReminder';

/**
 * Computes whether the "create a fresh backup" reminder should show, based on
 * how many transactions have occurred since the last backup/verification.
 * @param {number|null} transactionCount - current transaction count for the account, or null if not yet loaded
 */
export function useBackupReminder(transactionCount) {
  const threshold = getBackupReminderThreshold();
  const { lastBackupTransactionCount, lastBackupTimestamp } = getLastBackupInfo();

  const hasCount = typeof transactionCount === 'number';
  const transactionsSinceBackup = hasCount ? Math.max(0, transactionCount - lastBackupTransactionCount) : 0;
  const showReminder = hasCount && transactionsSinceBackup >= threshold && !isBackupReminderSnoozed();

  const dismiss = useCallback(() => {
    snoozeBackupReminder();
  }, []);

  return { showReminder, threshold, transactionsSinceBackup, lastBackupTimestamp, dismiss };
}
