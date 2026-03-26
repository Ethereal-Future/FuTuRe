import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Generates a Stellar payment URI.
 * If amount is provided: web+stellar:pay?destination=...&amount=...
 * Otherwise: just the public key (for receive-only QR).
 */
function buildQRData(publicKey, amount) {
  if (amount && parseFloat(amount) > 0) {
    return `web+stellar:pay?destination=${publicKey}&amount=${amount}&asset_code=XLM`;
  }
  return publicKey;
}

export function QRCodeModal({ publicKey, onClose }) {
  const canvasRef = useRef(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, buildQRData(publicKey, amount), {
      width: 220,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' },
    }).catch((err) => setError(err.message));
  }, [publicKey, amount]);

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
    >
      <motion.div
        className="qr-modal"
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.85, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="QR Code"
      >
        <div className="qr-header">
          <h3>QR Code</h3>
          <button className="qr-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="qr-canvas-wrap">
          {error
            ? <p style={{ color: '#ef4444' }}>Failed to generate QR: {error}</p>
            : <canvas ref={canvasRef} />
          }
        </div>

        <p className="qr-pubkey">{publicKey}</p>

        <div className="qr-amount-row">
          <input
            type="number"
            min="0"
            step="any"
            placeholder="Include amount (optional)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="qr-amount-input"
            aria-label="Payment amount"
          />
        </div>
        {amount && parseFloat(amount) > 0 && (
          <p className="qr-hint">QR encodes a payment request for {amount} XLM</p>
        )}

        <button className="qr-download" onClick={handleDownload}>
          ⬇ Download PNG
        </button>
      </motion.div>
    </motion.div>
  );
}
