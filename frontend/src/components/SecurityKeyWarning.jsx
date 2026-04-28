import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * SecurityKeyWarning — displays when secret key is shown.
 * Shows critical security warnings about secret key exposure.
 * Props: onAcknowledge
 */
export function SecurityKeyWarning({ onAcknowledge }) {
  return (
    <motion.div
      className="security-warning"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      style={{
        background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
        border: '2px solid #ef4444',
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'start', gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 24 }}>🔐</span>
        <div>
          <h3 style={{ margin: '0 0 4px 0', color: '#991b1b', fontSize: 16 }}>
            Secret Key Security Alert
          </h3>
          <p style={{ margin: 0, fontSize: 12, color: '#7f1d1d' }}>
            Your secret key is displayed. Keep it secure and private.
          </p>
        </div>
      </div>

      {/* Warning list */}
      <div style={{ background: 'white', borderRadius: 6, padding: 12, marginBottom: 12 }}>
        <ul style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          fontSize: 13,
          color: '#7f1d1d',
        }}>
          <li style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <span>⚠️</span>
            <span><strong>Never share</strong> your secret key with anyone, including support staff</span>
          </li>
          <li style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <span>⚠️</span>
            <span><strong>Never paste</strong> your secret key into websites or applications you don't trust</span>
          </li>
          <li style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <span>⚠️</span>
            <span><strong>Store offline</strong> in a secure location (hardware wallet, encrypted file, etc.)</span>
          </li>
          <li style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <span>⚠️</span>
            <span><strong>Screenshot carefully</strong> and store in encrypted cloud storage only</span>
          </li>
          <li style={{ display: 'flex', gap: 8 }}>
            <span>⚠️</span>
            <span><strong>Anyone with this key</strong> can access and transfer all your funds</span>
          </li>
        </ul>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <motion.button
          onClick={() => onAcknowledge?.()}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          style={{
            background: '#ef4444',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            flex: 1,
            minWidth: 120,
          }}
        >
          I Understand the Risks
        </motion.button>
      </div>
    </motion.div>
  );
}

/**
 * SecretKeyDisplay — shows secret key with copy button and security warning.
 * Props: secretKey, publicKey
 */
export function SecretKeyDisplay({ secretKey, publicKey }) {
  const [revealed, setRevealed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(null);

  const handleCopy = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const masked = '•'.repeat(secretKey.length);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{ marginTop: 16 }}
    >
      {!acknowledged && (
        <SecurityKeyWarning onAcknowledge={() => setAcknowledged(true)} />
      )}

      <AnimatePresence>
        {acknowledged && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{ marginBottom: 16 }}
          >
            <div style={{ marginBottom: 12 }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                color: '#555',
              }}>
                Public Key (safe to share)
              </label>
              <div style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                background: '#f0f9ff',
                border: '1px solid #bfdbfe',
                borderRadius: 4,
                padding: 10,
              }}>
                <code style={{
                  flex: 1,
                  fontSize: 12,
                  overflow: 'auto',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                }}>
                  {publicKey}
                </code>
                <motion.button
                  onClick={() => handleCopy(publicKey, 'public')}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  style={{
                    background: 'white',
                    border: '1px solid #bfdbfe',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 12,
                    cursor: 'pointer',
                    width: 'auto',
                    minHeight: 'unset',
                  }}
                >
                  {copied === 'public' ? '✓ Copied' : 'Copy'}
                </motion.button>
              </div>
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                color: '#555',
              }}>
                Secret Key (Keep Private & Secure)
              </label>
              <div style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                background: '#fef2f2',
                border: '2px solid #ef4444',
                borderRadius: 4,
                padding: 10,
              }}>
                <code style={{
                  flex: 1,
                  fontSize: 12,
                  overflow: 'auto',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                  color: revealed ? '#991b1b' : '#999',
                }}>
                  {revealed ? secretKey : masked}
                </code>
                <motion.button
                  onClick={() => setRevealed(!revealed)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  style={{
                    background: revealed ? '#fecaca' : 'white',
                    color: revealed ? '#991b1b' : '#666',
                    border: '1px solid #ef4444',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 12,
                    cursor: 'pointer',
                    width: 'auto',
                    minHeight: 'unset',
                    fontWeight: 600,
                  }}
                >
                  {revealed ? '👁 Hide' : '👁 Show'}
                </motion.button>
                <motion.button
                  onClick={() => handleCopy(secretKey, 'secret')}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={!revealed}
                  style={{
                    background: revealed ? '#ef4444' : '#e5e7eb',
                    color: revealed ? 'white' : '#999',
                    border: 'none',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 12,
                    cursor: revealed ? 'pointer' : 'not-allowed',
                    width: 'auto',
                    minHeight: 'unset',
                    fontWeight: 600,
                  }}
                >
                  {copied === 'secret' ? '✓ Copied' : 'Copy'}
                </motion.button>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              style={{
                background: '#fef3c7',
                border: '1px solid #fbbf24',
                borderRadius: 4,
                padding: 10,
                marginTop: 10,
                fontSize: 12,
                color: '#78350f',
              }}
            >
              💡 <strong>Tip:</strong> Save both keys somewhere secure before leaving this page.
              They will not be displayed again.
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
