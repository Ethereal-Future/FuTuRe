import { useState, useEffect } from 'react';
import axios from 'axios';
import { AddressBook } from './AddressBook';
import { WebhookManager } from './WebhookManager';
import { BackupSettings } from './BackupSettings';
import { ComplianceDashboard } from './ComplianceDashboard';

const ASSETS = ['XLM', 'USDC', 'EURC'];

export function AccountSettings({ publicKey, onClose }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [showCompliance, setShowCompliance] = useState(false);
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    axios.get(`/api/stellar/account/${publicKey}/settings`)
      .then(({ data }) => {
        setSettings(data);
        // Check if user has admin role from JWT token
        const token = localStorage.getItem('authToken');
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            setUserRole(payload.role);
          } catch (e) {
            // Invalid token format
          }
        }
      })
      .catch(e => setError(e?.response?.data?.error ?? e.message));
  }, [publicKey]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await axios.put(`/api/stellar/account/${publicKey}/settings`, {
        defaultAsset: settings.defaultAsset,
        notificationsOn: settings.notificationsOn,
      });
      setSaved(true);
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="replay-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="replay-modal" style={{ maxWidth: 480, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 id="settings-title" style={{ margin: 0 }}>Account Settings</h2>
          <button type="button" className="qr-close" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        {!settings && !error && <p>Loading…</p>}
        {error && <p role="alert" style={{ color: '#ef4444' }}>{error}</p>}

        {settings && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="default-asset" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
                Default Asset
              </label>
              <select
                id="default-asset"
                value={settings.defaultAsset}
                onChange={e => setSettings(s => ({ ...s, defaultAsset: e.target.value }))}
                aria-label="Default asset"
              >
                {ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                id="notifications-toggle"
                type="checkbox"
                checked={settings.notificationsOn}
                onChange={e => setSettings(s => ({ ...s, notificationsOn: e.target.checked }))}
                style={{ width: 'auto', minHeight: 'unset' }}
              />
              <label htmlFor="notifications-toggle" style={{ fontWeight: 600, cursor: 'pointer' }}>
                Notifications enabled
              </label>
            </div>

            <div style={{ marginBottom: 16 }}>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>KYC Status</p>
              {settings.kycStatus ? (
                <p style={{ margin: 0 }}>
                  <span style={{
                    background: settings.kycStatus === 'APPROVED' ? '#22c55e' : settings.kycStatus === 'REJECTED' ? '#ef4444' : '#f59e0b',
                    color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: '0.8rem', fontWeight: 600,
                  }}>
                    {settings.kycStatus}
                  </span>
                  {settings.kycSubmittedAt && (
                    <span style={{ marginLeft: 8, fontSize: '0.8rem', color: 'var(--text-muted, #64748b)' }}>
                      Submitted {new Date(settings.kycSubmittedAt).toLocaleDateString()}
                    </span>
                  )}
                </p>
              ) : (
                <p style={{ margin: 0, color: 'var(--text-muted, #64748b)', fontSize: '0.9rem' }}>No KYC record on file.</p>
              )}
            </div>

            <div style={{ marginBottom: 16 }}>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>Address Book</p>
              <AddressBook />
            </div>

            <div style={{ marginBottom: 16 }}>
              <WebhookManager accountId={publicKey} />
            </div>

            <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowBackup(true)}
                style={{ fontSize: '0.9rem', padding: '8px 16px' }}
              >
                💾 Backup & Restore
              </button>
              {userRole === 'admin' && (
                <button
                  type="button"
                  onClick={() => setShowCompliance(true)}
                  style={{ fontSize: '0.9rem', padding: '8px 16px', background: '#dc2626' }}
                >
                  🛡️ Compliance Dashboard
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn-clear" onClick={onClose}>Close</button>
              {saved && <span role="status" style={{ color: '#22c55e', fontSize: '0.9rem' }}>Saved ✓</span>}
            </div>
          </>
        )}

        {showBackup && <BackupSettings onClose={() => setShowBackup(false)} />}
        {showCompliance && <ComplianceDashboard onClose={() => setShowCompliance(false)} />}
      </div>
    </div>
  );
}
