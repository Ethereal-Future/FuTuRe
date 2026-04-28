import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * XLMInfoIcon - Info icon with tooltip explaining XLM currency
 * Accessible, keyboard navigable, mobile friendly
 */
export function XLMInfoIcon({ className = '' }) {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef(null);
  const tooltipRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const handleToggle = () => setIsOpen(!isOpen);

  return (
    <span className={`xlm-info-wrapper ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className="xlm-info-btn"
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleToggle();
          }
        }}
        aria-label="Information about XLM currency"
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
            initial={{ opacity: 0, scale: 0.95, y: -5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -5 }}
            transition={{ duration: 0.15 }}
          >
            <strong>XLM (Lumens)</strong> is the native currency of the Stellar network. 
            It's used to pay transaction fees and maintain minimum account balances.
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
