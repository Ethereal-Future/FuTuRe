import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function NetworkBadge({ status }) {
  const [expanded, setExpanded] = useState(false);

  if (!status) return null;

  const isTestnet = status.network === 'testnet';
  const online = status.online;

  return (
    <div className="net-badge-wrap">
      <button
        className={`net-badge ${online ? 'online' : 'offline'}`}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Network status"
      >
        <span className={`net-dot ${online ? 'online' : 'offline'}`} />
        {isTestnet ? 'Testnet' : 'Mainnet'}
        {!online && ' ⚠'}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            className="net-panel"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            role="tooltip"
          >
            <p><strong>Network:</strong> {status.network}</p>
            <p><strong>Horizon:</strong> {status.horizonUrl}</p>
            <p><strong>Status:</strong> {online ? '✅ Online' : '❌ Offline'}</p>
            {status.horizonVersion && <p><strong>Horizon v:</strong> {status.horizonVersion}</p>}
            {status.currentProtocolVersion && <p><strong>Protocol:</strong> {status.currentProtocolVersion}</p>}
            {isTestnet && (
              <p className="net-warning">⚠ You are on Testnet — funds have no real value</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
