import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Deterministic confetti pieces — fixed seed so no hydration mismatch
const CONFETTI = Array.from({ length: 22 }, (_, i) => {
  const angle = (i / 22) * 360;
  const radius = 60 + (i % 5) * 22;
  const rad = (angle * Math.PI) / 180;
  return {
    id: i,
    x: Math.cos(rad) * radius,
    y: Math.sin(rad) * radius,
    rotate: angle * 2,
    color: ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7'][i % 6],
    size: 7 + (i % 3) * 3,
    shape: i % 3 === 0 ? 'circle' : 'rect',
  };
});

/**
 * AccountCreatedCelebration
 *
 * Props:
 *   visible        — boolean, controls AnimatePresence
 *   onDone         — called when the animation finishes so parent can proceed
 *   reducedMotion  — boolean, skips animation and calls onDone immediately
 */
export function AccountCreatedCelebration({ visible, onDone, reducedMotion }) {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!visible) return;
    // If user prefers reduced motion, skip straight to done
    const delay = reducedMotion ? 0 : 2200;
    timerRef.current = setTimeout(() => onDone?.(), delay);
    return () => clearTimeout(timerRef.current);
  }, [visible, reducedMotion, onDone]);

  if (reducedMotion) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="celebration-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.45)',
            backdropFilter: 'blur(3px)',
          }}
          role="status"
          aria-live="polite"
          aria-label="Account created successfully"
        >
          {/* Confetti burst */}
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            {CONFETTI.map((p) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, x: '50vw', y: '50vh', scale: 0, rotate: 0 }}
                animate={{
                  opacity: [0, 1, 1, 0],
                  x: `calc(50vw + ${p.x}px)`,
                  y: `calc(50vh + ${p.y}px)`,
                  scale: [0, 1.2, 1, 0.6],
                  rotate: p.rotate,
                }}
                transition={{ duration: 1.6, ease: 'easeOut', delay: 0.1 }}
                style={{
                  position: 'absolute',
                  width: p.size,
                  height: p.shape === 'circle' ? p.size : p.size * 0.5,
                  borderRadius: p.shape === 'circle' ? '50%' : 2,
                  background: p.color,
                  top: 0,
                  left: 0,
                }}
              />
            ))}
          </div>

          {/* Checkmark card */}
          <motion.div
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.05 }}
            style={{
              background: 'white',
              borderRadius: 20,
              padding: '36px 48px',
              textAlign: 'center',
              boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
              minWidth: 240,
              position: 'relative',
              zIndex: 1,
            }}
          >
            {/* Pulsing ring behind checkmark */}
            <motion.div
              animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 1.2, repeat: 1, ease: 'easeOut' }}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -60%)',
                width: 80,
                height: 80,
                borderRadius: '50%',
                background: '#22c55e',
                opacity: 0.3,
                pointerEvents: 'none',
              }}
            />

            {/* Checkmark circle */}
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.15 }}
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                boxShadow: '0 4px 20px rgba(34,197,94,0.4)',
                position: 'relative',
                zIndex: 1,
              }}
            >
              {/* SVG checkmark drawn with stroke animation */}
              <motion.svg
                width="36"
                height="36"
                viewBox="0 0 36 36"
                fill="none"
                aria-hidden="true"
              >
                <motion.path
                  d="M8 18 L15 25 L28 11"
                  stroke="white"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.45, ease: 'easeOut', delay: 0.3 }}
                />
              </motion.svg>
            </motion.div>

            <motion.h2
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 700, color: '#0f172a' }}
            >
              Account Created!
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.65 }}
              style={{ margin: 0, fontSize: 13, color: '#64748b' }}
            >
              Save your secret key — it won't be shown again.
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
