import { useState, useEffect, useCallback } from 'react';
import apiClient from '../api/client.js';
import { motion } from 'framer-motion';
import { FormField } from './FormField';
import { Spinner } from './Spinner';
import { StatusMessage } from './StatusMessage';
import { getBackupReminderThreshold, setBackupReminderThreshold } from '../utils/backupReminder';

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        width: 48,
        height: 24,
        padding: 2,
        background: checked ? '#22c55e' : '#d1d5db',
        border: 'none',
        borderRadius: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background-color 0.2s',
      }}
      aria-label={`Toggle ${checked ? 'on' : 'off'}`}
    >
      <motion.div
        animate={{ x: checked ? 24 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        style={{
          width: 20,
          height: 20,
          background: '#fff',
          borderRadius: '50%',
        }}
      />
    </button>
  );
}

export function NotificationPreferences() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const [preferences, setPreferences] = useState({
    email: true,
    push: true,
    sms: false,
    inApp: true,
    quietHoursStart: 22,
    quietHoursEnd: 7,
    weeklyDigestEnabled: false,
    weeklyDigestDay: 1,
    weeklyDigestTime: 9,
    lowBalanceAlertEnabled: false,
    lowBalanceThreshold: 10.0,
    lowBalanceAsset: 'XLM',
  });

  const [backupReminderThreshold, setBackupReminderThresholdValue] = useState(() => getBackupReminderThreshold());

  const handleBackupReminderThresholdChange = (value) => {
    const n = parseInt(value, 10);
    const normalized = Number.isFinite(n) && n > 0 ? n : 1;
    setBackupReminderThresholdValue(normalized);
    setBackupReminderThreshold(normalized);
  };

  const fetchPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const { preferences: prefs } = await apiClient.get('/api/notifications/preferences');
      setPreferences({
        email: prefs.emailEnabled ?? true,
        push: prefs.pushEnabled ?? true,
        sms: prefs.smsEnabled ?? false,
        inApp: prefs.inAppEnabled ?? true,
        quietHoursStart: prefs.quietHoursStart ?? 22,
        quietHoursEnd: prefs.quietHoursEnd ?? 7,
        weeklyDigestEnabled: prefs.weeklyDigestEnabled ?? false,
        weeklyDigestDay: prefs.weeklyDigestDay ?? 1,
        weeklyDigestTime: prefs.weeklyDigestTime ?? 9,
        lowBalanceAlertEnabled: prefs.lowBalanceAlertEnabled ?? false,
        lowBalanceThreshold: prefs.lowBalanceThreshold ?? 10.0,
        lowBalanceAsset: prefs.lowBalanceAsset ?? 'XLM',
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load preferences');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const handleToggle = (channel) => {
    setPreferences((prev) => ({ ...prev, [channel]: !prev[channel] }));
  };

  const handleQuietHoursChange = (field, value) => {
    setPreferences((prev) => ({ ...prev, [field]: parseInt(value, 10) }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      await apiClient.put('/api/notifications/preferences', {
        email: preferences.email,
        push: preferences.push,
        sms: preferences.sms,
        inApp: preferences.inApp,
        quietHoursStart: preferences.quietHoursStart,
        quietHoursEnd: preferences.quietHoursEnd,
        weeklyDigestEnabled: preferences.weeklyDigestEnabled,
        weeklyDigestDay: preferences.weeklyDigestDay,
        weeklyDigestTime: preferences.weeklyDigestTime,
        lowBalanceAlertEnabled: preferences.lowBalanceAlertEnabled,
        lowBalanceThreshold: parseFloat(preferences.lowBalanceThreshold),
        lowBalanceAsset: preferences.lowBalanceAsset,
      });

      setSuccess('Notification preferences saved successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save preferences');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;

  return (
    <section className="section" aria-labelledby="notifications-heading">
      <h2 id="notifications-heading" style={{ marginBottom: 16 }}>Notification Preferences</h2>

      {error && <StatusMessage type="error" message={error} />}
      {success && <StatusMessage type="success" message={success} />}

      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Notification Channels */}
        <div style={{ paddingBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12 }}>Notification Channels</h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              {
                key: 'email',
                label: 'Email Notifications',
                description: 'Receive important updates via email',
              },
              {
                key: 'push',
                label: 'Push Notifications',
                description: 'Real-time alerts on your device',
              },
              {
                key: 'sms',
                label: 'SMS Notifications',
                description: 'Text message alerts for urgent items',
              },
              {
                key: 'inApp',
                label: 'In-App Notifications',
                description: 'Notifications within the app interface',
              },
            ].map((channel) => (
              <div
                key={channel.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 12,
                  background: '#f9fafb',
                  borderRadius: 6,
                }}
              >
                <div>
                  <p style={{ margin: '0 0 4px 0', fontWeight: 500, fontSize: '0.95rem' }}>
                    {channel.label}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>
                    {channel.description}
                  </p>
                </div>
                <Toggle
                  checked={preferences[channel.key]}
                  onChange={() => handleToggle(channel.key)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Quiet Hours */}
        <div style={{ paddingBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12 }}>Quiet Hours</h3>
          <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: 12 }}>
            Notifications will not be sent during these hours (local time).
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Start Time" required>
              <select
                value={preferences.quietHoursStart}
                onChange={(e) => handleQuietHoursChange('quietHoursStart', e.target.value)}
                style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
              >
                {Array.from({ length: 24 }).map((_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="End Time" required>
              <select
                value={preferences.quietHoursEnd}
                onChange={(e) => handleQuietHoursChange('quietHoursEnd', e.target.value)}
                style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
              >
                {Array.from({ length: 24 }).map((_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <p style={{ fontSize: '0.875rem', color: '#666', marginTop: 12 }}>
            Quiet hours: {String(preferences.quietHoursStart).padStart(2, '0')}:00 to{' '}
            {String(preferences.quietHoursEnd).padStart(2, '0')}:00
          </p>
        </div>

        {/* Weekly Email Digest */}
        <div style={{ paddingBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Weekly Transaction Digest</h3>
            <Toggle
              checked={preferences.weeklyDigestEnabled}
              onChange={() => setPreferences((prev) => ({ ...prev, weeklyDigestEnabled: !prev.weeklyDigestEnabled }))}
            />
          </div>
          <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: 12 }}>
            Receive a weekly summary of your transaction activity via email.
          </p>

          {preferences.weeklyDigestEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Delivery Day" required>
                <select
                  value={preferences.weeklyDigestDay}
                  onChange={(e) => setPreferences((prev) => ({ ...prev, weeklyDigestDay: parseInt(e.target.value, 10) }))}
                  style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
                >
                  <option value={0}>Sunday</option>
                  <option value={1}>Monday</option>
                  <option value={2}>Tuesday</option>
                  <option value={3}>Wednesday</option>
                  <option value={4}>Thursday</option>
                  <option value={5}>Friday</option>
                  <option value={6}>Saturday</option>
                </select>
              </FormField>

              <FormField label="Delivery Time (UTC)" required>
                <select
                  value={preferences.weeklyDigestTime}
                  onChange={(e) => setPreferences((prev) => ({ ...prev, weeklyDigestTime: parseInt(e.target.value, 10) }))}
                  style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
                >
                  {Array.from({ length: 24 }).map((_, i) => (
                    <option key={i} value={i}>
                      {String(i).padStart(2, '0')}:00
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
          )}
        </div>

        {/* Low Balance Alert */}
        <div style={{ paddingBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Low Balance Alert</h3>
            <Toggle
              checked={preferences.lowBalanceAlertEnabled}
              onChange={() => setPreferences((prev) => ({ ...prev, lowBalanceAlertEnabled: !prev.lowBalanceAlertEnabled }))}
            />
          </div>
          <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: 12 }}>
            Get notified when your account balance drops below a threshold.
          </p>

          {preferences.lowBalanceAlertEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <FormField label="Alert Threshold" required>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={preferences.lowBalanceThreshold}
                  onChange={(e) => setPreferences((prev) => ({ ...prev, lowBalanceThreshold: e.target.value }))}
                  style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
                  placeholder="e.g., 10.0"
                />
              </FormField>

              <FormField label="Asset" required>
                <select
                  value={preferences.lowBalanceAsset}
                  onChange={(e) => setPreferences((prev) => ({ ...prev, lowBalanceAsset: e.target.value }))}
                  style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
                >
                  <option value="XLM">XLM (Stellar Lumens)</option>
                  <option value="USDC">USDC</option>
                  <option value="BTC">BTC</option>
                  <option value="ETH">ETH</option>
                </select>
              </FormField>
            </div>
          )}
        </div>

        {/* Backup Reminder */}
        <div style={{ paddingBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 12 }}>Backup Reminder</h3>
          <p style={{ fontSize: '0.875rem', color: '#666', marginBottom: 12 }}>
            Show a dismissible reminder to create a fresh backup after this many new transactions since your last
            backup or verification.
          </p>
          <FormField label="Transactions Before Reminder" required>
            <input
              type="number"
              min="1"
              step="1"
              value={backupReminderThreshold}
              onChange={(e) => handleBackupReminderThresholdChange(e.target.value)}
              style={{ width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' }}
            />
          </FormField>
        </div>

        {/* Info Box */}
        <div style={{ padding: 12, background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 4 }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#1e40af' }}>
            💡 <strong>Tip:</strong> Keep in-app notifications enabled to stay updated even when quiet hours are active.
          </p>
        </div>

        {/* Save Button */}
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: 12,
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
            fontWeight: 600,
          }}
        >
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
      </form>
    </section>
  );
}
