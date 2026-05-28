import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * FormWizard — multi-step form with progress indicator.
 * Props:
 *   steps: [{ title, content: (props) => JSX, validate?: () => bool }]
 *   onComplete: (allData) => void
 */
export function FormWizard({ steps = [], onComplete }) {
  const [current, setCurrent] = useState(0);
  const [direction, setDirection] = useState(1);

  const isLast = current === steps.length - 1;
  const step = steps[current];

  const go = (delta) => {
    if (delta > 0 && step.validate && !step.validate()) return;
    setDirection(delta);
    setCurrent(c => c + delta);
  };

  const finish = () => {
    if (step.validate && !step.validate()) return;
    onComplete?.();
  };

  const variants = {
    enter: (d) => ({ x: d > 0 ? 40 : -40, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d) => ({ x: d > 0 ? -40 : 40, opacity: 0 }),
  };

  return (
    <div>
      {/* Progress bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: '100%', height: 4, borderRadius: 2,
              background: i <= current ? '#0066cc' : '#e5e7eb',
              transition: 'background 0.3s',
            }} />
            <span style={{ fontSize: 11, color: i === current ? '#0066cc' : '#888', fontWeight: i === current ? 700 : 400 }}>
              {s.title}
            </span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div style={{ overflow: 'hidden', position: 'relative', minHeight: 80 }}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={current}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2 }}
          >
            {step.content}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {current > 0 && (
          <button type="button" onClick={() => go(-1)} style={backBtnStyle}>
            ← Back
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={isLast ? finish : () => go(1)} style={{ width: 'auto' }}>
          {isLast ? 'Submit' : 'Next →'}
        </button>
      </div>
    </div>
  );
}

const backBtnStyle = {
  background: 'white', color: '#0066cc', border: '1px solid #0066cc',
  borderRadius: 4, padding: '10px 16px', fontSize: 14, cursor: 'pointer',
  width: 'auto', minHeight: 44,
};
