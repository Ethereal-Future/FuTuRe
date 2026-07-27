import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

export function NetworkBadge({ status }) {
  const { t } = useTranslation();
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
        aria-label={t('networkBadge.ariaLabel')}
      >
        <span className={`net-dot ${online ? 'online' : 'offline'}`} />
        {isTestnet ? t('networkBadge.testnet') : t('networkBadge.mainnet')}
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
            <p><strong>{t('networkBadge.networkLabel')}</strong> {status.network}</p>
            <p><strong>{t('networkBadge.horizonLabel')}</strong> {status.horizonUrl}</p>
            <p><strong>{t('networkBadge.statusLabel')}</strong> {online ? t('networkBadge.online') : t('networkBadge.offline')}</p>
            {status.horizonVersion && <p><strong>{t('networkBadge.horizonVersionLabel')}</strong> {status.horizonVersion}</p>}
            {status.currentProtocolVersion && <p><strong>{t('networkBadge.protocolLabel')}</strong> {status.currentProtocolVersion}</p>}
            {isTestnet && (
              <p className="net-warning">{t('networkBadge.testnetWarning')}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
