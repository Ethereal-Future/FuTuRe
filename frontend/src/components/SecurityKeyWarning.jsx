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
    >
      <div className="security-warning__header">
        <span className="security-warning__icon">🔐</span>
        <div>
          <h3 className="security-warning__title">Secret Key Security Alert</h3>
          <p className="security-warning__subtitle">Your secret key is displayed. Keep it secure and private.</p>
        </div>
      </div>

      <ul className="security-warning__list">
        <li className="security-warning__list-item">
          <span className="security-warning__list-icon">⚠️</span>
          <span><strong>Never share</strong> your secret key with anyone, including support staff</span>
        </li>
        <li className="security-warning__list-item">
          <span className="security-warning__list-icon">⚠️</span>
          <span><strong>Never paste</strong> your secret key into websites or applications you don't trust</span>
        </li>
        <li className="security-warning__list-item">
          <span className="security-warning__list-icon">⚠️</span>
          <span><strong>Store offline</strong> in a secure location (hardware wallet, encrypted file, etc.)</span>
        </li>
        <li className="security-warning__list-item">
          <span className="security-warning__list-icon">⚠️</span>
          <span><strong>Screenshot carefully</strong> and store in encrypted cloud storage only</span>
        </li>
        <li className="security-warning__list-item">
          <span className="security-warning__list-icon">⚠️</span>
          <span><strong>Anyone with this key</strong> can access and transfer all your funds</span>
        </li>
      </ul>

      <div className="security-warning__actions">
        <motion.button
          onClick={() => onAcknowledge?.()}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="security-warning__button"
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
      className="secret-key-display"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
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
            <div className="secret-key-display__field">
              <label className="secret-key-display__label">Public Key (safe to share)</label>
              <div className="secret-key-display__input-group secret-key-display__input-group--public">
                <code className="secret-key-display__code">{publicKey}</code>
                <motion.button
                  onClick={() => handleCopy(publicKey, 'public')}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="secret-key-display__button"
                >
                  {copied === 'public' ? '✓ Copied' : 'Copy'}
                </motion.button>
              </div>
            </div>

            <div className="secret-key-display__field">
              <label className="secret-key-display__label">Secret Key (Keep Private & Secure)</label>
              <div className="secret-key-display__input-group secret-key-display__input-group--secret">
                <code className={`secret-key-display__code ${revealed ? 'secret-key-display__code--secret' : 'secret-key-display__code--masked'}`}>
                  {revealed ? secretKey : masked}
                </code>
                <motion.button
                  onClick={() => setRevealed(!revealed)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="secret-key-display__button secret-key-display__button--reveal"
                >
                  {revealed ? '👁 Hide' : '👁 Show'}
                </motion.button>
                <motion.button
                  onClick={() => handleCopy(secretKey, 'secret')}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  disabled={!revealed}
                  className="secret-key-display__button secret-key-display__button--copy"
                >
                  {copied === 'secret' ? '✓ Copied' : 'Copy'}
                </motion.button>
              </div>
            </div>

            <motion.div
              className="secret-key-display__tip"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
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
