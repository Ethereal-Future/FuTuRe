import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { motion, AnimatePresence } from 'framer-motion';
import { useFocusTrap } from '../hooks/useFocusTrap';

function buildQRData(publicKey, amount) {
  if (amount && parseFloat(amount) > 0) {
    return `web+stellar:pay?destination=${publicKey}&amount=${amount}&asset_code=XLM`;
  }
  return publicKey;
}

export function QRCodeModal({ publicKey, onClose }) {
  const canvasRef = useRef(null);
  const modalRef = useRef(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(null);

  useFocusTrap(modalRef, true);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, buildQRData(publicKey, amount), {
      width: 220, margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' },
    }).catch((err) => setError(err.message));
  }, [publicKey, amount]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `stellar-qr-${publicKey.slice(0, 8)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <motion.div
      className="qr-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      aria-hidden="true"
    >
      <motion.div
        ref={modalRef}
        className="qr-modal"
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.85, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
        aria-describedby="qr-modal-desc"
      >
        <div className="qr-header">
          <h3 id="qr-modal-title">QR Code</h3>
          <button className="qr-close" onClick={onClose} aria-label="Close QR code dialog">✕</button>
        </div>

        <div className="qr-canvas-wrap" aria-hidden="true">
          {error
            ? <p style={{ color: '#ef4444' }} role="alert">Failed to generate QR: {error}</p>
            : <canvas ref={canvasRef} aria-label={`QR code for Stellar address ${publicKey}`} />
          }
        </div>

        <p id="qr-modal-desc" className="qr-pubkey">{publicKey}</p>

        <div className="qr-amount-row">
          <label htmlFor="qr-amount" className="sr-only">Include payment amount (optional)</label>
          <input
            id="qr-amount"
            type="number"
            min="0"
            step="any"
            placeholder="Include amount (optional)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="qr-amount-input"
            aria-label="Payment amount to encode in QR"
          />
        </div>
        {amount && parseFloat(amount) > 0 && (
          <p className="qr-hint" aria-live="polite">QR encodes a payment request for {amount} XLM</p>
        )}

        <button className="qr-download" onClick={handleDownload} aria-label="Download QR code as PNG image">
          ⬇ Download PNG
        </button>
      </motion.div>
    </motion.div>
  );
}
