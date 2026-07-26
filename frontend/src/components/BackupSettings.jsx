import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppState } from '../store/index.js';
import {
  encryptBackup,
  serializeBackupFile,
  buildBackupFilename,
  downloadBackupFile,
  scorePasswordStrength,
} from '../utils/backup.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_BACKUP_PASSWORD_LENGTH = 8;

export function BackupSettings({ onClose }) {
  const { account, accountLabel } = useAppState();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [backups, setBackups] = useState([]);

  const [backupPassword, setBackupPassword] = useState('');
  const [backupPasswordConfirm, setBackupPasswordConfirm] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [downloadSuccess, setDownloadSuccess] = useState(null);

  useEffect(() => {
    loadStatus();
    loadBackups();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get('/api/backup/status');
      setStatus(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load backup status');
    } finally {
      setLoading(false);
    }
  };

  const loadBackups = async () => {
    try {
      const { data } = await apiClient.get('/api/backup');
      setBackups(data);
    } catch (err) {
      console.error('Failed to load backups:', err);
    }
  };

  const createBackup = async () => {
    setCreating(true);
    setError(null);
    try {
      await apiClient.post('/api/backup', { tag: 'manual' });
      await loadStatus();
      await loadBackups();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  const downloadBackup = (filename) => {
    // In a real implementation, this would download the backup file
    // For now, we'll just show an alert
    alert(`Download functionality would retrieve: ${filename}`);
  };

  const downloadEncryptedBackup = async (e) => {
    e.preventDefault();
    setDownloadError(null);
    setDownloadSuccess(null);

    if (!account?.publicKey || !account?.secretKey) {
      setDownloadError('No account is loaded to back up.');
      return;
    }
    if (backupPassword.length < MIN_BACKUP_PASSWORD_LENGTH) {
      setDownloadError(`Backup password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (backupPassword !== backupPasswordConfirm) {
      setDownloadError('Backup passwords do not match.');
      return;
    }

    setDownloading(true);
    try {
      const payload = {
        publicKey: account.publicKey,
        secretKey: account.secretKey,
        accountLabel: accountLabel || '',
        createdAt: new Date().toISOString(),
      };
      const envelope = await encryptBackup(payload, backupPassword);
      const filename = buildBackupFilename();
      downloadBackupFile(filename, serializeBackupFile(envelope));

      setDownloadSuccess(`Backup downloaded as ${filename}. Store the file and your password separately.`);
      setBackupPassword('');
      setBackupPasswordConfirm('');
    } catch {
      setDownloadError('Failed to create encrypted backup. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  const passwordStrength = scorePasswordStrength(backupPassword);

  const isStale = status?.lastBackup
    ? Date.now() - new Date(status.lastBackup.timestamp).getTime() > SEVEN_DAYS_MS
    : true;

  return (
    <div
      className="replay-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backup-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="replay-modal" style={{ maxWidth: 600, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 id="backup-title" style={{ margin: 0 }}>Backup & Restore</h2>
          <button type="button" className="qr-close" onClick={onClose} aria-label="Close backup settings">
            ✕
          </button>
        </div>

        {error && (
          <div role="alert" style={{ padding: 12, background: '#fee', color: '#c00', borderRadius: 4, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {loading && <p>Loading backup status...</p>}

        {!loading && (
          <>
            {/* Last Backup Info */}
            <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8 }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>Last Backup</h3>
              {status?.lastBackup ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 600 }}>Timestamp:</span>
                    <span>{new Date(status.lastBackup.timestamp).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontWeight: 600 }}>File:</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{status.lastBackup.file}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600 }}>Size:</span>
                    <span>{(status.lastBackup.size / 1024).toFixed(2)} KB</span>
                  </div>
                  {isStale && (
                    <div
                      role="alert"
                      style={{
                        marginTop: 12,
                        padding: 12,
                        background: '#fef3c7',
                        color: '#92400e',
                        borderRadius: 4,
                        fontSize: '0.9rem',
                      }}
                    >
                      ⚠️ Warning: No backup has been taken in the last 7 days. Consider creating a new backup.
                    </div>
                  )}
                </>
              ) : (
                <p style={{ color: 'var(--text-muted, #64748b)', margin: 0 }}>
                  No backups found. Create your first backup below.
                </p>
              )}
            </div>

            {/* Create Backup Button */}
            <div style={{ marginBottom: 24 }}>
              <button
                type="button"
                onClick={createBackup}
                disabled={creating}
                style={{ width: '100%', padding: '12px 16px', fontSize: '1rem' }}
              >
                {creating ? 'Creating Backup...' : '💾 Create Manual Backup'}
              </button>
            </div>

            {/* Encrypted Backup Download */}
            <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8 }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>Download Encrypted Backup</h3>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
                Export your keypair and settings as an encrypted file you can store offline (USB drive, password
                manager, etc). Choose a backup password below — you will need it to restore or verify this backup.
              </p>

              <div
                role="alert"
                style={{ marginBottom: 12, padding: 12, background: '#fef3c7', color: '#92400e', borderRadius: 4, fontSize: '0.85rem' }}
              >
                ⚠️ Store the backup password separately from the downloaded file. Anyone with both can access your
                account. We cannot recover this password if you lose it.
              </div>

              {downloadError && (
                <div role="alert" style={{ padding: 12, background: '#fee', color: '#c00', borderRadius: 4, marginBottom: 12 }}>
                  {downloadError}
                </div>
              )}
              {downloadSuccess && (
                <div role="status" style={{ padding: 12, background: '#ecfdf5', color: '#166534', borderRadius: 4, marginBottom: 12 }}>
                  ✅ {downloadSuccess}
                </div>
              )}

              <form onSubmit={downloadEncryptedBackup}>
                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="backup-password" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
                    Backup Password
                  </label>
                  <input
                    id="backup-password"
                    type="password"
                    value={backupPassword}
                    onChange={(e) => setBackupPassword(e.target.value)}
                    placeholder={`At least ${MIN_BACKUP_PASSWORD_LENGTH} characters`}
                    autoComplete="new-password"
                  />
                  {backupPassword && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)' }}>
                      Strength: {passwordStrength.label}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label htmlFor="backup-password-confirm" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 4 }}>
                    Confirm Backup Password
                  </label>
                  <input
                    id="backup-password-confirm"
                    type="password"
                    value={backupPasswordConfirm}
                    onChange={(e) => setBackupPasswordConfirm(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>

                <button type="submit" disabled={downloading} style={{ width: '100%', padding: '12px 16px', fontSize: '1rem' }}>
                  {downloading ? 'Encrypting…' : '🔒 Download Encrypted Backup'}
                </button>
              </form>
            </div>

            {/* Backup Metrics */}
            {status?.metrics && (
              <div style={{ marginBottom: 24, padding: 16, background: 'var(--bg-secondary, #f9fafb)', borderRadius: 8 }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>Backup Statistics</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>Total Backups</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{status.metrics.totalBackups || 0}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>Total Size</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                      {((status.metrics.totalSize || 0) / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Available Backups */}
            {backups.length > 0 && (
              <div>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>Available Backups</h3>
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {backups.slice(0, 10).map((backup, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 12px',
                        borderBottom: '1px solid #e5e7eb',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{backup.file}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748b)' }}>
                          {new Date(backup.timestamp).toLocaleString()} · {(backup.size / 1024).toFixed(2)} KB
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => downloadBackup(backup.file)}
                        style={{ fontSize: '0.8rem', padding: '4px 12px' }}
                      >
                        Download
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
