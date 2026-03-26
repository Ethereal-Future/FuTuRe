import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const VARIANTS = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -8, scale: 0.97 },
};

function Message({ msg, onRemove, onRetry }) {
  return (
    <motion.div
      className={`sm-item sm-${msg.type}`}
      variants={VARIANTS}
      initial="hidden" animate="visible" exit="exit"
      layout
      role="alert"
      aria-live={msg.type === 'error' ? 'assertive' : 'polite'}
    >
      <span className="sm-icon">{msg.icon}</span>
      <span className="sm-text">{msg.message}</span>
      {msg.retry && (
        <button className="sm-retry" onClick={() => { onRetry(msg.id); msg.retry(); }}>Retry</button>
      )}
      <button className="sm-close" onClick={() => onRemove(msg.id)} aria-label="Dismiss">✕</button>
    </motion.div>
  );
}

export function StatusMessage({ messages, onRemove, showHistory = false, history = [] }) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="sm-wrap">
      <AnimatePresence initial={false}>
        {messages.map((msg) => (
          <Message key={msg.id} msg={msg} onRemove={onRemove} onRetry={onRemove} />
        ))}
      </AnimatePresence>

      {showHistory && history.length > 0 && (
        <div className="sm-history">
          <button className="sm-history-toggle" onClick={() => setHistoryOpen(v => !v)}>
            {historyOpen ? '▲' : '▼'} Message history ({history.length})
          </button>
          <AnimatePresence>
            {historyOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="sm-history-list"
              >
                {history.map((msg) => (
                  <div key={msg.id} className={`sm-history-item sm-${msg.type}`}>
                    <span>{msg.icon}</span>
                    <span className="sm-text">{msg.message}</span>
                    <span className="sm-time">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
