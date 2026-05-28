import { useState } from 'react';
import axios from 'axios';

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

export function AccountMerge({ sourceSecret, onClose, onSuccess }) {
  const [destination, setDestination] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isValidDestination = STELLAR_PUBLIC_KEY.test(destination);
  const isConfirmed = confirmText.toUpperCase() === 'MERGE';

  const handleMerge = async () => {
    if (!isValidDestination || !isConfirmed) return;

    setLoading(true);
    setError(null);

    try {
      const { data } = await axios.post('/api/stellar/account/merge', {
        sourceSecret,
        destination,
      });
      onSuccess?.(data);
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="replay-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-title"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="replay-modal" style={{ maxWidth: 520, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 id="merge-title" style={{ margin: 0, color: '#dc2626' }}>⚠️ Merge Account</h2>
          <button type="button" className="qr-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div
          role="alert"
          style={{
            background: '#fef2f2',
            border: '2px solid #dc2626',
            borderRadius: 8,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, color: '#dc2626', marginBottom: 8 }}>
            ⚠️ WARNING: This action is IRREVERSIBLE
          </p>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#991b1b' }}>
            <li>All XLM will be transferred to the destination account</li>
            <li>Your source account will be permanently closed</li>
            <li>You will lose access to this account forever</li>
            <li>This operation cannot be undone</li>
          </ul>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="destination" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Destination Account (Public Key)
          </label>
          <input
            id="destination"
            type="text"
            value={destination}
            onChange={e => setDestination(e.target.value.trim())}
            placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
            style={{
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              borderColor: destination && !isValidDestination ? '#dc2626' : undefined,
            }}
          />
          {destination && !isValidDestination && (
            <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '4px 0 0' }}>
              Invalid Stellar public key
            </p>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <label htmlFor="confirm" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Type "MERGE" to confirm
          </label>
          <input
            id="confirm"
            type="text"
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            placeholder="MERGE"
            style={{
              borderColor: confirmText && !isConfirmed ? '#dc2626' : undefined,
            }}
          />
        </div>

        {error && (
          <p role="alert" style={{ color: '#dc2626', marginBottom: 16 }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleMerge}
            disabled={!isValidDestination || !isConfirmed || loading}
            style={{
              background: '#dc2626',
              opacity: !isValidDestination || !isConfirmed || loading ? 0.5 : 1,
            }}
          >
            {loading ? 'Merging…' : 'Merge Account'}
          </button>
          <button type="button" className="btn-clear" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
