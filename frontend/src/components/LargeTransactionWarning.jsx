import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * LargeTransactionWarning — warns when transferring large amounts.
 * Props: amount, threshold (default 1000), assetCode (default XLM)
 */
export function LargeTransactionWarning({ amount, threshold = 1000, assetCode = 'XLM', onConfirm }) {
  const [confirmed, setConfirmed] = useState(false);
  const numAmount = parseFloat(amount);
  const isLarge = !isNaN(numAmount) && numAmount > threshold;

  if (!isLarge) return null;

  const handleConfirm = () => {
    setConfirmed(true);
    onConfirm?.();
  };

  return (
    <motion.div
      className="large-tx-warning"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      style={{
        background: 'linear-gradient(135deg, #fef3c7 0%, #fed7aa 100%)',
        border: '2px solid #f59e0b',
        borderRadius: 8,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'start' }}>
        <span style={{ fontSize: 22 }}>⚠️</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: '0 0 6px 0', color: '#92400e', fontSize: 14 }}>
            Large Transaction
          </h3>
          <p style={{ margin: '0 0 10px 0', fontSize: 13, color: '#b45309' }}>
            You are about to send <strong>{numAmount.toLocaleString()} {assetCode}</strong>.
            Please verify the details carefully:
          </p>

          <ul style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 10px 0',
            fontSize: 12,
            color: '#92400e',
          }}>
            <li style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <span>✓</span>
              <span><strong>Recipient address</strong> is correct and verified</span>
            </li>
            <li style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <span>✓</span>
              <span><strong>Amount</strong> ({numAmount.toLocaleString()}) is correct</span>
            </li>
            <li style={{ display: 'flex', gap: 6 }}>
              <span>✓</span>
              <span><strong>Network</strong> (testnet/mainnet) is correct</span>
            </li>
          </ul>

          {!confirmed ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <motion.button
                onClick={handleConfirm}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                style={{
                  background: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  padding: '8px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ✓ I've Verified Everything
              </motion.button>
              <p style={{
                margin: 0,
                fontSize: 11,
                color: '#78350f',
                alignSelf: 'center',
              }}>
                Click to proceed with the transaction
              </p>
            </div>
          ) : (
            <div style={{
              background: '#dcfce7',
              border: '1px solid #86efac',
              borderRadius: 4,
              padding: 8,
              fontSize: 12,
              color: '#166534',
              fontWeight: 600,
            }}>
              ✓ Verified. Ready to send.
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * TransactionReviewCard — shows transaction details for review.
 * Props: recipient, amount, assetCode, balance
 */
export function TransactionReviewCard({ recipient, amount, assetCode = 'XLM', balance }) {
  const numAmount = parseFloat(amount);
  const numBalance = parseFloat(balance);
  const remaining = numBalance - numAmount;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      style={{
        background: '#f8f9fa',
        border: '1px solid #ddd',
        borderRadius: 6,
        padding: 12,
        marginBottom: 12,
      }}
    >
      <h4 style={{ margin: '0 0 10px 0', fontSize: 13, fontWeight: 600 }}>
        Transaction Details
      </h4>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        fontSize: 13,
      }}>
        <div>
          <p style={{ margin: '0 0 4px 0', fontSize: 11, color: '#666' }}>To:</p>
          <p style={{
            margin: 0,
            fontFamily: 'monospace',
            fontSize: 11,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#0066cc',
          }}>
            {recipient}
          </p>
        </div>
        <div>
          <p style={{ margin: '0 0 4px 0', fontSize: 11, color: '#666' }}>Amount:</p>
          <p style={{ margin: 0, fontWeight: 600, color: '#ef4444' }}>
            {numAmount.toLocaleString()} {assetCode}
          </p>
        </div>
        <div>
          <p style={{ margin: '0 0 4px 0', fontSize: 11, color: '#666' }}>Current Balance:</p>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {numBalance.toLocaleString()} {assetCode}
          </p>
        </div>
        <div>
          <p style={{ margin: '0 0 4px 0', fontSize: 11, color: '#666' }}>After Transaction:</p>
          <p style={{
            margin: 0,
            fontWeight: 600,
            color: remaining > 0 ? '#22c55e' : '#ef4444'
          }}>
            {remaining.toLocaleString()} {assetCode}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
