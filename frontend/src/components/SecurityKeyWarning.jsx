import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { makeVariants, tapScale } from '../utils/animations';

/**
 * SecurityKeyWarning — displays when secret key is shown.
 * Shows critical security warnings about secret key exposure.
 * Props: onAcknowledge
 */
export function SecurityKeyWarning({ onAcknowledge }) {
  const { t } = useTranslation();
  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);
  const tap = tapScale(prefersReduced);
  return (
    <motion.div
      className="security-warning"
      variants={v.pop} initial="hidden" animate="visible" exit="exit"
    >
      <div className="security-warning__header">
        <span className="security-warning__icon">🔐</span>
        <div>
          <h3 className="security-warning__title">{t('securityKeyWarning.title')}</h3>
          <p className="security-warning__subtitle">{t('securityKeyWarning.subtitle')}</p>
        </div>
      </div>

      <ul className="security-warning__list">
        <li className="security-warning__list-item">
          <span className="security-warning__list-icon">⚠️</span>
          <span><strong>{t('securityKeyWarning.neverShareStrong')}</strong> {t('securityKeyWarning.neverShareRest')}</span>
        </li>
        <li className="security-warning__list-item">
          <span className="security-warning__list-icon">⚠️</span>
          <span><strong>{t('securityKeyWarning.neverPasteStrong')}</strong> {t('securityKeyWarning.neverPasteRest')}</span>
        </li>
        <li className="security-warning__list-item">
          <span className="security-warning__list-icon">⚠️</span>
          <span><strong>{t('securityKeyWarning.storeOfflineStrong')}</strong> {t('securityKeyWarning.storeOfflineRest')}</span>
        </li>
        <li className="security-warning__list-item">
          <span className="security-warning__list-icon">⚠️</span>
          <span><strong>{t('securityKeyWarning.screenshotStrong')}</strong> {t('securityKeyWarning.screenshotRest')}</span>
        </li>
        <li className="security-warning__list-item">
          <span className="security-warning__list-icon">⚠️</span>
          <span><strong>{t('securityKeyWarning.anyoneStrong')}</strong> {t('securityKeyWarning.anyoneRest')}</span>
        </li>
      </ul>

      <div className="security-warning__actions">
        <motion.button
          onClick={() => onAcknowledge?.()}
          {...tap}
          className="security-warning__button"
        >
          {t('securityKeyWarning.acknowledge')}
        </motion.button>
      </div>
    </motion.div>
  );
}

/**
 * SecretKeyDisplay — shows secret key with copy button and security warning.
 * Props: secretKey, publicKey
 */
export function SecretKeyDisplay({ secretKey, publicKey }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(null);
  const prefersReduced = useReducedMotion();
  const v = makeVariants(prefersReduced);
  const tap = tapScale(prefersReduced);

  const handleCopy = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const masked = '•'.repeat(secretKey.length);

  return (
    <motion.div
      className="secret-key-display"
      variants={v.fadeSlide} initial="hidden" animate="visible"
    >
      {!acknowledged && (
        <SecurityKeyWarning onAcknowledge={() => setAcknowledged(true)} />
      )}

      <AnimatePresence>
        {acknowledged && (
          <motion.div
            variants={v.fadeSlide} initial="hidden" animate="visible" exit="exit"
            style={{ marginBottom: 16 }}
          >
            <div className="secret-key-display__field">
              <label className="secret-key-display__label">{t('secretKeyDisplay.publicKeyLabel')}</label>
              <div className="secret-key-display__input-group secret-key-display__input-group--public">
                <code className="secret-key-display__code">{publicKey}</code>
                <motion.button
                  onClick={() => handleCopy(publicKey, 'public')}
                  {...tap}
                  className="secret-key-display__button"
                >
                  {copied === 'public' ? t('secretKeyDisplay.copied') : t('secretKeyDisplay.copy')}
                </motion.button>
              </div>
            </div>

            <div className="secret-key-display__field">
              <label className="secret-key-display__label">{t('secretKeyDisplay.secretKeyLabel')}</label>
              <div className="secret-key-display__input-group secret-key-display__input-group--secret">
                <code className={`secret-key-display__code ${revealed ? 'secret-key-display__code--secret' : 'secret-key-display__code--masked'}`}>
                  {revealed ? secretKey : masked}
                </code>
                <motion.button
                  onClick={() => setRevealed(!revealed)}
                  {...tap}
                  className="secret-key-display__button secret-key-display__button--reveal"
                >
                  {revealed ? t('secretKeyDisplay.hide') : t('secretKeyDisplay.show')}
                </motion.button>
                <motion.button
                  onClick={() => handleCopy(secretKey, 'secret')}
                  {...tap}
                  disabled={!revealed}
                  className="secret-key-display__button secret-key-display__button--copy"
                >
                  {copied === 'secret' ? t('secretKeyDisplay.copied') : t('secretKeyDisplay.copy')}
                </motion.button>
              </div>
            </div>

            <motion.div
              className="secret-key-display__tip"
              variants={v.fadeSlide} initial="hidden" animate="visible"
            >
              💡 <strong>{t('secretKeyDisplay.tipStrong')}</strong> {t('secretKeyDisplay.tipRest')}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
