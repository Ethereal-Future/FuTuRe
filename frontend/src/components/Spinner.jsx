import { motion } from 'framer-motion';

export function Spinner({ label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
      <motion.span
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.7, ease: 'linear' }}
        style={{ display: 'inline-block' }}
        aria-hidden="true"
      >⟳</motion.span>
      {label && <span>{label}</span>}
    </span>
  );
}
