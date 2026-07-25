import { useEffect, useRef } from 'react';

/**
 * Traps focus within `containerRef` while active.
 * Returns focus to `returnRef` (or previously focused element) on cleanup.
 */
export function useFocusTrap(containerRef, active) {
  const returnFocusRef = useRef(null);

  useEffect(() => {
    if (!active) return;

    returnFocusRef.current = document.activeElement;

    const container = containerRef.current;
    if (!container) return;

    const FOCUSABLE = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled])',
      'select:not([disabled])', 'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const getFocusable = () => [...container.querySelectorAll(FOCUSABLE)];

    // Focus first element
    const first = getFocusable()[0];
    first?.focus();

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      } else {
        if (document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    };

    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [active, containerRef]);
}
