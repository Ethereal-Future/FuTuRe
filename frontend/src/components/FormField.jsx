import { AnimatePresence, motion } from 'framer-motion';
import { Children, cloneElement, useId } from 'react';

/**
 * FormField — labelled input wrapper with validation state.
 * Props: label, error, touched, children, required
 * Automatically associates the label with the child input via htmlFor/id.
 */
export function FormField({ label, error, touched, children, required }) {
  const autoId = useId();

  const child =
    label && Children.count(children) === 1
      ? cloneElement(Children.only(children), {
          id: Children.only(children).props?.id ?? autoId,
        })
      : children;

  const inputId =
    label && Children.count(children) === 1
      ? (Children.only(children).props?.id ?? autoId)
      : undefined;

  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#555' }}
        >
          {label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
        </label>
      )}
      {child}
      <AnimatePresence>
        {touched && error && (
          <motion.p
            className="field-error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
