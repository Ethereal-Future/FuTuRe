import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { FormField } from './FormField';
import { Spinner } from './Spinner';
import { StatusMessage } from './StatusMessage';

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
  });

  const fetchPreferences = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/notifications/preferences');
      setPreferences({
        email: data.preferences.emailEnabled ?? true,
        push: data.preferences.pushEnabled ?? true,
        sms: data.preferences.smsEnabled ?? false,
        inApp: data.preferences.inAppEnabled ?? true,
        quietHoursStart: data.preferences.quietHoursStart ?? 22,
        quietHoursEnd: data.preferences.quietHoursEnd ?? 7,
      });
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load preferences');
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
      await axios.put('/api/notifications/preferences', {
        email: preferences.email,
        push: preferences.push,
        sms: preferences.sms,
        inApp: preferences.inApp,
        quietHoursStart: preferences.quietHoursStart,
        quietHoursEnd: preferences.quietHoursEnd,
      });

      setSuccess('Notification preferences saved successfully!');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save preferences');
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
