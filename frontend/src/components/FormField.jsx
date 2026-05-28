import { AnimatePresence, motion } from 'framer-motion';

/**
 * FormField — labelled input wrapper with validation state.
 * Props: label, error, touched, children
 */
export function FormField({ label, error, touched, children, required }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#555' }}>
          {label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
        </label>
      )}
      {children}
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
