import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * Parses a raw QR string into a Stellar public key.
 * Handles plain addresses and web+stellar:pay URIs.
 */
function extractAddress(raw) {
  if (raw.startsWith('web+stellar:')) {
    const dest = new URLSearchParams(raw.split('?')[1]).get('destination');
    return dest ?? raw;
  }
  return raw.trim();
}

export function QRScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const modalRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);

  useFocusTrap(modalRef, true);

  useEffect(() => {
    let cancelled = false;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        video.play();

        const tick = () => {
          if (cancelled) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);
            const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(data, width, height);
            if (code) {
              onScan(extractAddress(code.data));
              return; // stop scanning after first hit
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [onScan]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="qr-overlay"
      onClick={onClose}
      aria-hidden="true"
    >
      <div
        ref={modalRef}
        className="qr-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-scanner-title"
      >
        <div className="qr-header">
          <h3 id="qr-scanner-title">Scan QR Code</h3>
          <button className="qr-close" onClick={onClose} aria-label="Close QR scanner">✕</button>
        </div>

        {error ? (
          <p style={{ color: '#ef4444', padding: '1rem' }} role="alert">
            Camera unavailable: {error}
          </p>
        ) : (
          <div style={{ position: 'relative' }}>
            <video
              ref={videoRef}
              style={{ width: '100%', borderRadius: '8px', display: 'block' }}
              muted
              playsInline
              aria-label="Camera viewfinder for QR scanning"
            />
            <canvas ref={canvasRef} style={{ display: 'none' }} aria-hidden="true" />
            <p style={{ textAlign: 'center', marginTop: '0.5rem', fontSize: '0.875rem', opacity: 0.7 }}>
              Point camera at a Stellar address QR code
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
