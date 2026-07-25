import { motion, AnimatePresence } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * NetworkWarning — displays network-specific warnings.
 * Props: networkStatus (from useNetworkStatus)
 */
export function NetworkWarning({ networkStatus }) {
  if (!networkStatus) return null;

  const isTestnet = networkStatus.network === 'testnet';
  const online = networkStatus.online;

  if (isTestnet) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          background: 'linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)',
          border: '2px solid #0284c7',
          borderRadius: 8,
          padding: 14,
          marginBottom: 14,
          display: 'flex',
          gap: 12,
        }}
        role="status"
        aria-live="polite"
        aria-label="You are using testnet with test funds"
      >
        <span style={{ fontSize: 22, flexShrink: 0 }} aria-hidden="true">🧪</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px 0', color: '#0c4a6e', fontSize: 14, fontWeight: 600 }}>
            Testnet Mode
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: '#0c4a6e' }}>
            You are using Stellar <strong>Testnet</strong>. Funds have <strong>no real value</strong> here.
            This is suitable for testing and development only. For real transactions, switch to Mainnet.
          </p>
        </div>
      </motion.div>
    );
  }

  if (!online) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
          border: '2px solid #ef4444',
          borderRadius: 8,
          padding: 14,
          marginBottom: 14,
          display: 'flex',
          gap: 12,
        }}
        role="alert"
        aria-live="assertive"
      >
        <span style={{ fontSize: 22, flexShrink: 0 }} aria-hidden="true">🌐</span>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 4px 0', color: '#991b1b', fontSize: 14, fontWeight: 600 }}>
            Network Offline
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: '#7f1d1d' }}>
            Cannot connect to Stellar network. Check your internet connection and try again.
            Transactions are disabled until the network is available.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
        border: '2px solid #dc2626',
        borderRadius: 8,
        padding: 14,
        marginBottom: 14,
        display: 'flex',
        gap: 12,
      }}
      role="alert"
      aria-live="assertive"
      aria-label="You are using mainnet with real funds"
    >
      <span style={{ fontSize: 22, flexShrink: 0 }} aria-hidden="true">⚠️</span>
      <div style={{ flex: 1 }}>
        <h3 style={{ margin: '0 0 4px 0', color: '#7f1d1d', fontSize: 14, fontWeight: 600 }}>
          Real Funds — Mainnet Active
        </h3>
        <p style={{ margin: 0, fontSize: 13, color: '#7f1d1d' }}>
          <strong>You are using real funds on Stellar Mainnet.</strong> Verify all recipient addresses
          and transaction amounts carefully before sending. There is no undo.
        </p>
      </div>
    </motion.div>
  );
}

export function MainnetPaymentConfirmation({ amount, onConfirm, onCancel }) {
  const modalRef = useRef(null);
  useFocusTrap(modalRef, true);
  const [confirmed, setConfirmed] = useState(false);

  const xlmAmount = parseFloat(amount) || 0;
  const requiresConfirm = xlmAmount >= 10;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  if (!requiresConfirm) return null;

  return (
    <motion.div
      className="confirm-overlay"
      onClick={onCancel}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        ref={modalRef}
        className="confirm-modal"
        onClick={e => e.stopPropagation()}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mainnet-confirm-title"
      >
        <h2 id="mainnet-confirm-title" style={{ margin: '0 0 12px 0', color: '#7f1d1d' }}>
          Confirm Mainnet Payment
        </h2>
        <div style={{ background: '#fef2f2', padding: 12, borderRadius: 6, marginBottom: 14, borderLeft: '4px solid #dc2626' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: 13 }}>
            You are about to send <strong>{xlmAmount} XLM</strong> on <strong>Stellar Mainnet</strong> with real funds.
          </p>
          <p style={{ margin: 0, fontSize: 13 }}>
            This transaction cannot be reversed. Please verify the recipient address is correct.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input
            type="checkbox"
            id="mainnet-confirm-check"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            aria-label="I understand this transaction uses real funds and cannot be reversed"
          />
          <label htmlFor="mainnet-confirm-check" style={{ margin: 0, fontSize: 13 }}>
            I understand this transaction uses real funds and cannot be reversed
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => onConfirm?.()}
            disabled={!confirmed}
            style={{
              flex: 1,
              padding: '8px 12px',
              background: confirmed ? '#dc2626' : '#d1d5db',
              color: 'white',
              border: 'none',
              borderRadius: 6,
              cursor: confirmed ? 'pointer' : 'not-allowed',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Send {xlmAmount} XLM
          </button>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '8px 12px',
              background: '#e5e7eb',
              color: '#374151',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * NetworkStatus — quick network status display for forms.
 * Props: networkStatus, compact (show minimal version)
 */
export function NetworkStatus({ networkStatus, compact = false }) {
  if (!networkStatus) return null;

  const isTestnet = networkStatus.network === 'testnet';
  const online = networkStatus.online;

  if (compact) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: isTestnet ? '#dbeafe' : (online ? '#fee2e2' : '#fef2f2'),
        border: `1px solid ${isTestnet ? '#0284c7' : (online ? '#dc2626' : '#ef4444')}`,
        borderRadius: 4,
        fontSize: 12,
        color: isTestnet ? '#0c4a6e' : (online ? '#7f1d1d' : '#991b1b'),
        fontWeight: 500,
      }}>
        <span>{isTestnet ? '🧪' : (online ? '⚠️' : '❌')}</span>
        <span>{isTestnet ? 'Testnet' : (online ? 'Mainnet • Real Funds' : 'Offline')}</span>
      </div>
    );
  }

  if (isTestnet) {
    return (
      <div style={{
        padding: 10,
        background: '#dbeafe',
        border: '1px solid #0284c7',
        borderRadius: 6,
        fontSize: 12,
        color: '#0c4a6e',
      }}>
        🧪 Testnet — Test funds only, no real value
      </div>
    );
  }

  if (!online) {
    return (
      <div style={{
        padding: 10,
        background: '#fef2f2',
        border: '1px solid #ef4444',
        borderRadius: 6,
        fontSize: 12,
        color: '#991b1b',
      }}>
        ❌ Network Offline — Cannot process transactions
      </div>
    );
  }

  return (
    <div style={{
      padding: 10,
      background: '#fee2e2',
      border: '1px solid #dc2626',
      borderRadius: 6,
      fontSize: 12,
      color: '#7f1d1d',
    }}>
      ⚠️ Mainnet Connected — Real funds at risk
    </div>
  );
}
