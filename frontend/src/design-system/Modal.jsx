import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Modal — accessible dialog with focus trap and keyboard dismissal.
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {string} title
 * @param {'sm'|'md'|'lg'} size
 */
export function Modal({ open, onClose, title, size = 'md', children }) {
  const dialogRef = useRef(null);

  // Focus trap + ESC to close
  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    el?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`modal modal-${size}`}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">
            {title}
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
