import { useState } from 'react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

const MAX_FEE_KEY = 'maxFeeStroops';

function getMaxFeeStroops() {
  const stored = localStorage.getItem(MAX_FEE_KEY);
  return stored ? parseInt(stored, 10) : null;
}

/**
 * Dismissible banner shown when the Stellar network is offline, degraded, or fees are surging.
 * Polls /api/stellar/network-status every 30 seconds via useNetworkStatus.
 */
export function NetworkStatusBanner() {
  const { status } = useNetworkStatus(30000);
  const [dismissed, setDismissed] = useState(false);
  const [maxFeeInput, setMaxFeeInput] = useState(() => {
    const stored = getMaxFeeStroops();
    return stored ? String(stored) : '';
  });
  const [showFeeSettings, setShowFeeSettings] = useState(false);

  if (!status) return null;

  const isOffline = status.online === false;
  const isDegraded = status.status === 'degraded' && !status.feeSurge;
  const isFeeSurge = status.feeSurge === true;
  const maxFee = getMaxFeeStroops();
  const feeExceedsMax = maxFee && status.feeStroops && status.feeStroops > maxFee;

  const shouldShow = isOffline || isDegraded || isFeeSurge || feeExceedsMax;
  if (!shouldShow || dismissed) return null;

  let message;
  let background = '#ef4444';

  if (isOffline) {
    message = 'The Stellar network is offline. Transactions may fail.';
  } else if (isFeeSurge) {
    const avg = status.sevenDayAverageFeeStroops
      ? `${status.sevenDayAverageFeeStroops} stroops`
      : 'the 7-day average';
    message = `Network fees are unusually high (${status.feeSurgeRatio}x the average). Current fee: ${status.feeStroops} stroops vs avg ${avg}. Consider waiting for fees to normalise.`;
    background = '#f59e0b';
  } else if (feeExceedsMax) {
    message = `Current network fee (${status.feeStroops} stroops) exceeds your maximum (${maxFee} stroops). Consider waiting or raising your limit.`;
    background = '#f59e0b';
  } else {
    message = 'The Stellar network is degraded. Transactions may be slow or fail.';
    background = '#f59e0b';
  }

  const saveMaxFee = () => {
    const value = parseInt(maxFeeInput, 10);
    if (value > 0) {
      localStorage.setItem(MAX_FEE_KEY, String(value));
    } else {
      localStorage.removeItem(MAX_FEE_KEY);
    }
    setShowFeeSettings(false);
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        background,
        color: '#fff',
        padding: '10px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
      >
        <span>{message}</span>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss network status banner"
          style={{
            background: 'none',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
        <button
          type="button"
          onClick={() => setShowFeeSettings((s) => !s)}
          style={{
            background: 'rgba(255,255,255,0.2)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: '4px 10px',
            borderRadius: 4,
          }}
        >
          {showFeeSettings ? 'Hide fee limit' : 'Set max fee'}
        </button>
        {maxFee && !showFeeSettings && <span>Your max fee: {maxFee} stroops</span>}
      </div>
      {showFeeSettings && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label htmlFor="max-fee-input" style={{ fontSize: '0.85rem' }}>
            Max fee (stroops):
          </label>
          <input
            id="max-fee-input"
            type="number"
            min="100"
            step="100"
            value={maxFeeInput}
            onChange={(e) => setMaxFeeInput(e.target.value)}
            style={{ width: 120, padding: '4px 8px', borderRadius: 4, border: 'none' }}
          />
          <button
            type="button"
            onClick={saveMaxFee}
            style={{
              background: '#fff',
              color: '#1e293b',
              border: 'none',
              padding: '4px 12px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
