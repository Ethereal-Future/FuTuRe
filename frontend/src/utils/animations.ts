import type { Variants } from 'framer-motion';

interface AnimationVariants {
  fadeSlide: Variants;
  pop: Variants;
  stagger: Variants;
}

interface TapScaleResult {
  whileTap?: { scale: number };
  whileHover?: { scale: number };
}

// Respects prefers-reduced-motion: pass `reducedMotion` (boolean) to disable transitions
export function makeVariants(reducedMotion: boolean): AnimationVariants {
  return {
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
  };
}

export function tapScale(reducedMotion: boolean): TapScaleResult {
  return reducedMotion ? {} : { whileTap: { scale: 0.96 }, whileHover: { scale: 1.02 } };
}
