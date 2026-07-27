import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { makeVariants } from '../utils/animations';

function buildQRData(publicKey, amount) {
  if (amount && parseFloat(amount) > 0) {
    return `web+stellar:pay?destination=${publicKey}&amount=${amount}&asset_code=XLM`;
  }
  return publicKey;
}

export function QRCodeModal({ publicKey, onClose }) {
  const { t } = useTranslation();
  const canvasRef = useRef(null);
  const modalRef = useRef(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(null);
  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);

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
      variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit"
      onClick={onClose}
      aria-hidden="true"
    >
      <motion.div
        ref={modalRef}
        className="qr-modal"
        variants={v.pop}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
        aria-describedby="qr-modal-desc"
      >
        <div className="qr-header">
          <h3 id="qr-modal-title">{t('qrCodeModal.title')}</h3>
          <button className="qr-close" onClick={onClose} aria-label={t('qrCodeModal.close')}>✕</button>
        </div>

        <div className="qr-canvas-wrap" aria-hidden="true">
          {error
            ? <p style={{ color: '#ef4444' }} role="alert">{t('qrCodeModal.failedToGenerate', { error })}</p>
            : <canvas ref={canvasRef} aria-label={t('qrCodeModal.canvasAriaLabel', { publicKey })} />
          }
        </div>

        <p id="qr-modal-desc" className="qr-pubkey">{publicKey}</p>

        <div className="qr-amount-row">
          <label htmlFor="qr-amount" className="sr-only">{t('qrCodeModal.includeAmountLabel')}</label>
          <input
            id="qr-amount"
            type="number"
            min="0"
            step="any"
            placeholder={t('qrCodeModal.includeAmountPlaceholder')}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="qr-amount-input"
            aria-label={t('qrCodeModal.amountAriaLabel')}
          />
        </div>
        {amount && parseFloat(amount) > 0 && (
          <p className="qr-hint" aria-live="polite">{t('qrCodeModal.paymentRequestHint', { amount })}</p>
        )}

        <button className="qr-download" onClick={handleDownload} aria-label={t('qrCodeModal.downloadAriaLabel')}>
          {t('qrCodeModal.downloadPng')}
        </button>
      </motion.div>
    </motion.div>
  );
}
