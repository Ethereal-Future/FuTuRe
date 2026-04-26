import { useState, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function BackupSettings({ onClose }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [backups, setBackups] = useState([]);

  useEffect(() => {
    loadStatus();
    loadBackups();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await axios.get('/api/backup/status');
      setStatus(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load backup status');
    } finally {
      setLoading(false);
    }
  };

  const loadBackups = async () => {
    try {
      const { data } = await axios.get('/api/backup');
      setBackups(data);
    } catch (err) {
      console.error('Failed to load backups:', err);
    }
  };

  const createBackup = async () => {
    setCreating(true);
    setError(null);
    try {
      await axios.post('/api/backup', { tag: 'manual' });
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
