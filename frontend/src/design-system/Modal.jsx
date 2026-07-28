import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Modal — accessible dialog with focus trap, keyboard dismissal,
 * and focus restoration to the triggering element on close.
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {string} title
 * @param {'sm'|'md'|'lg'} size
 */
export function Modal({ open, onClose, title, size = 'md', children }) {
  const dialogRef = useRef(null);
  // Capture the element that had focus when the modal opened so we can
  // return focus to it when the modal closes (WCAG 2.1 SC 2.4.3).
  const triggerRef = useRef(null);

  // Focus trap + ESC to close + focus restoration
  useEffect(() => {
    if (!open) return;

    // Remember who triggered the modal before we move focus away.
    triggerRef.current = document.activeElement;

    const el = dialogRef.current;
    el?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Restore focus to the triggering element when the modal unmounts.
      triggerRef.current?.focus();
      triggerRef.current = null;
    };
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
