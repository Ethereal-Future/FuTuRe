import { motion } from 'framer-motion';

/**
 * Dismissible PWA install banner.
 * Shows when the browser fires `beforeinstallprompt` and the user has not
 * dismissed it within the last 7 days.
 */
export function InstallBanner({ onInstall, onDismiss }) {
  return (
    <motion.div
      className="pwa-banner pwa-banner--install"
      role="banner"
      aria-label="Install app"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
    >
      <span className="pwa-banner__text">
        Install the Stellar Remittance app for faster access and offline support.
      </span>
      <div className="pwa-banner__actions">
        <button
          type="button"
          className="pwa-banner__btn"
          onClick={onInstall}
          aria-label="Install app"
        >
          Install
        </button>
        <button
          type="button"
          className="pwa-banner__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss install prompt"
        >
          ✕
        </button>
      </div>
    </motion.div>
  );
}
