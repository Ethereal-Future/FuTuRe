import { useEffect, useState } from 'react';
import { usePushNotifications } from '../hooks/usePushNotifications';

/**
 * NotificationPermissionManager - Manages push notification setup
 * Automatically registers service worker and handles subscription
 */
export function NotificationPermissionManager({ publicKey, onStatusChange }) {
  const {
    supported,
    permission,
    subscribed,
    monitoring,
    loading,
    error,
    subscribe,
    unsubscribe,
    checkMonitoring,
  } = usePushNotifications();

  const [showPrompt, setShowPrompt] = useState(false);

  // Initialize service worker on mount
  useEffect(() => {
    const registerServiceWorker = async () => {
      if ('serviceWorker' in navigator) {
        try {
          await navigator.serviceWorker.register('/service-worker.js', {
            scope: '/',
          });
        } catch (err) {
          console.error('Service Worker registration failed:', err);
        }
      }
    };

    registerServiceWorker();
  }, []);

  // Check monitoring status on mount
  useEffect(() => {
    if (publicKey) {
      checkMonitoring(publicKey);
    }
  }, [publicKey, checkMonitoring]);

  // Notify parent of status changes
  useEffect(() => {
    onStatusChange?.({
      supported,
      permission,
      subscribed,
      monitoring,
    });
  }, [supported, permission, subscribed, monitoring, onStatusChange]);

  const handleSubscribe = async () => {
    const success = await subscribe(publicKey);
    if (success) {
      setShowPrompt(false);
    }
  };

  const handleUnsubscribe = async () => {
    await unsubscribe(publicKey);
  };

  if (!supported) {
    return null;
  }

  if (subscribed && monitoring) {
    return (
      <div style={{
        background: '#f0fdf4',
        border: '1px solid #bbf7d0',
        borderRadius: 6,
        padding: 12,
        marginBottom: 16,
        fontSize: '0.85rem',
        color: '#166534',
      }}>
        <p style={{ margin: 0 }}>
          ✅ Push notifications enabled for incoming payments
        </p>
      </div>
    );
  }

  if (permission === 'denied') {
    return (
      <div style={{
        background: '#fee2e2',
        border: '1px solid #fca5a5',
        borderRadius: 6,
        padding: 12,
        marginBottom: 16,
        fontSize: '0.85rem',
        color: '#991b1b',
      }}>
        <p style={{ margin: 0 }}>
          Notifications are blocked. Enable them in your browser settings to receive payment alerts.
        </p>
      </div>
    );
  }

  return (
    <>
      {showPrompt && (
        <div style={{
          background: '#fef3c7',
          border: '1px solid #fcd34d',
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
        }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#78350f', fontWeight: 600 }}>
            🔔 Enable Payment Notifications?
          </p>
          <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: '#78350f' }}>
            Get notified instantly when you receive Stellar payments.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleSubscribe}
              disabled={loading}
              style={{
                padding: '6px 12px',
                background: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '0.85rem',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Enabling...' : 'Enable'}
            </button>
            <button
              type="button"
              onClick={() => setShowPrompt(false)}
              style={{
                padding: '6px 12px',
                background: '#f3f4f6',
                color: '#6b7280',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Later
            </button>
          </div>
          {error && (
            <p style={{ margin: '8px 0 0 0', fontSize: '0.85rem', color: '#991b1b' }}>
              Error: {error}
            </p>
          )}
        </div>
      )}

      {!showPrompt && !subscribed && permission === 'default' && (
        <button
          type="button"
          onClick={() => setShowPrompt(true)}
          style={{
            width: '100%',
            padding: '10px',
            background: '#0066cc',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            marginBottom: 16,
            fontSize: '0.9rem',
            fontWeight: 500,
          }}
        >
          🔔 Enable Push Notifications
        </button>
      )}

      {subscribed && !monitoring && (
        <div style={{
          background: '#f0f9ff',
          border: '1px solid #bfdbfe',
          borderRadius: 6,
          padding: 12,
          marginBottom: 16,
          fontSize: '0.85rem',
          color: '#1e40af',
        }}>
          <p style={{ margin: '0 0 8px 0', fontWeight: 600 }}>
            ℹ️ Notifications enabled but not monitoring
          </p>
          <button
            type="button"
            onClick={handleUnsubscribe}
            disabled={loading}
            style={{
              padding: '6px 12px',
              background: '#e0f2fe',
              color: '#0369a1',
              border: '1px solid #7dd3fc',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >
            Disable
          </button>
        </div>
      )}
    </>
  );
}
