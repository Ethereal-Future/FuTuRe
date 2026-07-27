/**
 * BackupReminderBanner — dismissible nudge shown after N transactions have
 * occurred since the account's last backup/verification.
 * Props: transactionsSinceBackup, threshold, onBackupNow, onDismiss
 */
export function BackupReminderBanner({ transactionsSinceBackup, threshold, onBackupNow, onDismiss }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        marginBottom: 20,
        background: '#fef3c7',
        color: '#92400e',
        borderRadius: 8,
        fontSize: '0.9rem',
      }}
    >
      <span>
        ⚠️ You&apos;ve made {transactionsSinceBackup} transactions since your last backup (reminder threshold: {threshold}).
        Consider creating an updated backup.
      </span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onBackupNow}
          style={{ width: 'auto', padding: '6px 12px', fontSize: '0.85rem' }}
        >
          💾 Back Up Now
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss backup reminder"
          style={{
            width: 'auto',
            padding: '6px 10px',
            fontSize: '0.85rem',
            background: 'transparent',
            color: 'inherit',
            border: '1px solid currentColor',
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
