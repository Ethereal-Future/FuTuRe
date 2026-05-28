import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function PaymentConfirmationModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  recipient, 
  amount, 
  estimatedFee = '0.00001',
  loading = false 
}) {
  const isLargeAmount = parseFloat(amount) > 100;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && !loading) {
        onConfirm();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onConfirm, loading]);

  if (!isOpen) return null;

  const totalAmount = (parseFloat(amount) + parseFloat(estimatedFee)).toFixed(7);

  return (
    <motion.div
      className="payment-confirmation-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="payment-confirmation-modal"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Payment Confirmation"
      >
        <div className="payment-confirmation-header">
          <h3>Confirm Payment</h3>
          <button 
            className="payment-confirmation-close" 
            onClick={onClose} 
            aria-label="Close"
            disabled={loading}
          >
            ✕
          </button>
        </div>

        <div className="payment-confirmation-content">
          <div className="transaction-summary">
            <h4>Transaction Details</h4>
            
            <div className="summary-row">
              <label>Recipient:</label>
              <div className="recipient-address">
                <code>{recipient}</code>
              </div>
            </div>

            <div className="summary-row">
              <label>Amount:</label>
              <span className="amount">{amount} XLM</span>
            </div>

            <div className="summary-row">
              <label>Estimated Fee:</label>
              <span className="fee">{estimatedFee} XLM</span>
            </div>

            <div className="summary-divider" />

            <div className="summary-row total">
              <label>Total:</label>
              <span className="total-amount">{totalAmount} XLM</span>
            </div>
          </div>

          {isLargeAmount && (
            <motion.div 
              className="large-amount-warning"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <span className="warning-icon">⚠️</span>
              <div>
                <strong>Large Amount Warning</strong>
                <p>You are sending over 100 XLM. Please double-check the recipient address.</p>
              </div>
            </motion.div>
          )}
        </div>

        <div className="payment-confirmation-actions">
          <button 
            className="cancel-button"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </button>
          <button 
            className="confirm-button"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <>
                Sending...
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }}
                  style={{ display: 'inline-block', marginLeft: 8 }}
                >
                  ⟳
                </motion.span>
              </>
            ) : (
              'Confirm Payment'
            )}
          </button>
        </div>

        <div className="keyboard-hints">
          <small>Press <kbd>Enter</kbd> to confirm, <kbd>Escape</kbd> to cancel</small>
        </div>
      </motion.div>
    </motion.div>
  );
}
