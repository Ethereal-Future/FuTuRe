import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * SlideOver — panel that slides in from the right for master-detail views,
 * without navigating away from (and losing scroll position in) the list
 * behind it.
 */
export function SlideOver({ open, onClose, title, children }) {
  const panelRef = useRef(null);
  const triggerRef = useRef(null);

  // Remember what had focus before opening so we can restore it on close.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;
    } else {
      triggerRef.current?.focus?.();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    panelRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = panelRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="slideover-backdrop"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            className="slideover-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
          >
            <div className="slideover-header">
              {title && <h3>{title}</h3>}
              <button type="button" className="qr-close" onClick={onClose} aria-label="Close">✕</button>
            </div>
            <div className="slideover-content">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
