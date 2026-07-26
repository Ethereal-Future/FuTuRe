import { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const PULL_THRESHOLD = 70;
const MAX_PULL = 110;
const DRAG_RESISTANCE = 0.5;

/**
 * Wraps page content with a touch-driven pull-to-refresh gesture, the
 * mobile-native pattern for triggering a manual data refresh. Only engages
 * when the page is scrolled to the top, so it never fights normal vertical
 * scrolling further down the content.
 */
export function PullToRefresh({ onRefresh, disabled = false, children }) {
  const { t } = useTranslation();
  const startYRef = useRef(null);
  const pullingRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const atTop = () => (window.scrollY ?? document.documentElement.scrollTop ?? 0) <= 0;

  const handleTouchStart = useCallback((e) => {
    if (disabled || refreshing || !atTop()) return;
    startYRef.current = e.touches[0].clientY;
    pullingRef.current = true;
  }, [disabled, refreshing]);

  const handleTouchMove = useCallback((e) => {
    if (!pullingRef.current || startYRef.current == null) return;
    const delta = e.touches[0].clientY - startYRef.current;
    if (delta <= 0 || !atTop()) {
      pullingRef.current = false;
      setPullDistance(0);
      return;
    }
    setPullDistance(Math.min(delta * DRAG_RESISTANCE, MAX_PULL));
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!pullingRef.current) return;
    pullingRef.current = false;
    startYRef.current = null;

    if (pullDistance >= PULL_THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPullDistance(PULL_THRESHOLD);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, refreshing, onRefresh]);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ position: 'relative' }}
    >
      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: pullDistance,
          overflow: 'hidden',
          transition: pullingRef.current ? 'none' : 'height 0.2s ease',
        }}
      >
        {pullDistance > 0 && (
          <motion.span
            animate={{ rotate: refreshing ? 360 : (pullDistance / PULL_THRESHOLD) * 180 }}
            transition={refreshing ? { repeat: Infinity, duration: 0.7, ease: 'linear' } : { duration: 0 }}
            style={{ fontSize: 20, lineHeight: 1, color: 'var(--primary, #0066cc)' }}
            aria-hidden="true"
          >
            ⟳
          </motion.span>
        )}
        {refreshing && <span className="sr-only">{t('balance.refreshing')}</span>}
      </div>
      {children}
    </div>
  );
}
