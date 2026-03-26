// Respects prefers-reduced-motion: pass `reducedMotion` (boolean) to disable transitions
export const makeVariants = (reducedMotion) => ({
  fadeSlide: {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 16 },
    visible: { opacity: 1, y: 0, transition: { duration: reducedMotion ? 0 : 0.3, ease: 'easeOut' } },
    exit:    { opacity: 0, y: reducedMotion ? 0 : -8, transition: { duration: reducedMotion ? 0 : 0.2 } },
  },
  pop: {
    hidden:  { opacity: 0, scale: reducedMotion ? 1 : 0.92 },
    visible: { opacity: 1, scale: 1, transition: { duration: reducedMotion ? 0 : 0.25, ease: 'easeOut' } },
    exit:    { opacity: 0, scale: reducedMotion ? 1 : 0.95, transition: { duration: reducedMotion ? 0 : 0.15 } },
  },
  stagger: {
    visible: { transition: { staggerChildren: reducedMotion ? 0 : 0.07 } },
  },
});

export const tapScale = (reducedMotion) =>
  reducedMotion ? {} : { whileTap: { scale: 0.96 }, whileHover: { scale: 1.02 } };
