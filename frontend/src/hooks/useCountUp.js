import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

const DEFAULT_DURATION_MS = 700;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Animates a numeric value from its previous value to `value` using
 * requestAnimationFrame. Does not animate on first mount, and skips the
 * animation entirely when the user prefers reduced motion.
 */
export function useCountUp(value, { duration = DEFAULT_DURATION_MS } = {}) {
  const prefersReducedMotion = useReducedMotion();
  const numericValue = Number(value) || 0;
  const [display, setDisplay] = useState(numericValue);
  const prevValueRef = useRef(numericValue);
  const rafRef = useRef(null);
  const isFirstRef = useRef(true);

  useEffect(() => {
    const from = prevValueRef.current;
    prevValueRef.current = numericValue;

    if (isFirstRef.current) {
      isFirstRef.current = false;
      setDisplay(numericValue);
      return;
    }

    if (from === numericValue || prefersReducedMotion) {
      setDisplay(numericValue);
      return;
    }

    const startTime = performance.now();

    const tick = (now) => {
      const t = Math.min((now - startTime) / duration, 1);
      setDisplay(from + (numericValue - from) * easeOutCubic(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericValue, duration, prefersReducedMotion]);

  return display;
}
