import { useState } from 'react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

/**
 * Dismissible banner shown when the Stellar network is offline or degraded.
 * Polls /api/stellar/network/status every 30 seconds via useNetworkStatus.
 */
export function NetworkStatusBanner() {
  const { status } = useNetworkStatus(30000);
  const [dismissed, setDismissed] = useState(false);

  if (!status || status.online !== false && status.status !== 'degraded') return null;
  if (dismissed) return null;

  const isDegraded = status.status === 'degraded';
  const message = isDegraded
    ? 'The Stellar network is degraded. Transactions may be slow or fail.'
    : 'The Stellar network is offline. Transactions may fail.';

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        background: isDegraded ? '#f59e0b' : '#ef4444',
        color: '#fff',
        padding: '10px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span>{message}</span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss network status banner"
        style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
      >
        ✕
      </button>
    </div>
  );
}
