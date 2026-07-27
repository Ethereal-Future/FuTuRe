import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

/**
 * Dismissible PWA install banner.
 * Shows when the browser fires `beforeinstallprompt` and the user has not
 * dismissed it within the last 7 days.
 */
export function InstallBanner({ onInstall, onDismiss }) {
  const { t } = useTranslation();
  return (
    <motion.div
      className="pwa-banner pwa-banner--install"
      role="banner"
      aria-label={t('installBanner.ariaLabel')}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <span className="pwa-banner__text">
        {t('installBanner.text')}
      </span>
      <div className="pwa-banner__actions">
        <button
          type="button"
          className="pwa-banner__btn"
          onClick={onInstall}
          aria-label={t('installBanner.ariaLabel')}
        >
          {t('installBanner.install')}
        </button>
        <button
          type="button"
          className="pwa-banner__dismiss"
          onClick={onDismiss}
          aria-label={t('installBanner.dismiss')}
        >
          ✕
        </button>
      </div>
    </motion.div>
  );
}
