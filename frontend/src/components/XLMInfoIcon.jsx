import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

const HOVER_DELAY_MS = 300;

/**
 * XLMInfoIcon - Info icon with tooltip explaining XLM currency.
 * Shows on hover (with a short delay) or focus (immediately), dismisses on
 * mouse-out, blur, or Escape. Accessible, keyboard navigable, mobile friendly.
 */
export function XLMInfoIcon({ className = '' }) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef(null);
  const tooltipRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();

  const clearHoverTimer = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  };

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    clearHoverTimer();
    setIsOpen(false);
  }, []);

  const handleMouseEnter = () => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(open, HOVER_DELAY_MS);
  };

  const handleMouseLeave = () => close();

  const handleFocus = () => {
    clearHoverTimer();
    open();
  };

  const handleBlur = () => close();

  // Close on outside click (covers the tap-to-toggle mobile fallback)
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target)
      ) {
        close();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen, close]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        close();
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, close]);

  useEffect(() => clearHoverTimer, []);

  const handleClick = () => setIsOpen((prev) => !prev);

  return (
    <span
      className={`xlm-info-wrapper ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={buttonRef}
        type="button"
        className="xlm-info-btn"
        onClick={handleClick}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        aria-label={t('xlmInfo.title')}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? 'xlm-tooltip' : undefined}
      >
        ℹ️
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={tooltipRef}
            id="xlm-tooltip"
            className="xlm-tooltip"
            role="tooltip"
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95, y: -5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.95, y: -5 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
          >
            <strong>{t('xlmInfo.summary')}</strong>{' '}
            {t('xlmInfo.description')}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
