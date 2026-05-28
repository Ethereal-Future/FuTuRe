import { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { makeVariants, tapScale } from '../utils/animations';

/**
 * InlineConfirmation — non-blocking inline confirmation UI.
 *
 * @param {boolean}  isVisible
 * @param {string}   message
 * @param {Function} onConfirm
 * @param {Function} onCancel
 * @param {string}   confirmText
 * @param {string}   cancelText
 */
export function InlineConfirmation({
  isVisible,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Clear',
  cancelText = 'Cancel',
}) {
  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);
  const tap = tapScale(prefersReduced);
  const confirmRef = useRef(null);

  // Move focus to the confirm button when shown
  useEffect(() => {
    if (isVisible) confirmRef.current?.focus();
  }, [isVisible]);

  // Close on Escape
  useEffect(() => {
    if (!isVisible) return;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isVisible, onCancel]);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.span
          className="confirm-clear"
          role="group"
          aria-label="Confirm clear form"
          variants={v.fadeSlide}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <span id="confirm-clear-msg" className="confirm-clear__label">{message}</span>
          <motion.button
            ref={confirmRef}
            type="button"
            className="confirm-clear__yes"
            onClick={onConfirm}
            aria-label={`Confirm: ${confirmText}`}
            aria-describedby="confirm-clear-msg"
            {...tap}
          >
            {confirmText}
          </motion.button>
          <motion.button
            type="button"
            className="confirm-clear__no"
            onClick={onCancel}
            aria-label={`Cancel: ${cancelText}`}
            {...tap}
          >
            {cancelText}
          </motion.button>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
