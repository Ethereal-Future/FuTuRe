import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import StellarSdk from '@stellar/stellar-sdk';

const isValidSecretSeed = (key) => {
  try {
    return StellarSdk.StrKey.isValidEd25519SecretSeed(key);
  } catch {
    return false;
  }
};

const isValidPublicKey = (key) => {
  try {
    return StellarSdk.StrKey.isValidEd25519PublicKey(key);
  } catch {
    return false;
  }
};

export function ImportAccountForm({ onImport, loading }) {
  const { t } = useTranslation();
  const [secretKey, setSecretKey] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmedKey = secretKey.trim();
  const isValid = isValidSecretSeed(trimmedKey) || isValidPublicKey(trimmedKey);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid) {
      setTouched(true);
      return;
    }
    onImport(trimmedKey);
    setSecretKey('');
    setTouched(false);
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginTop: 12 }}>
      <div
        role="alert"
        style={{
          background: '#fef3c7',
          border: '1px solid #f59e0b',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 10,
          fontSize: '0.85rem',
          color: '#92400e',
        }}
      >
        {t('importAccount.warning')}
      </div>
      <div className="input-wrap">
        <input
          type="password"
          placeholder={t('importAccount.secretKeyPlaceholder')}
          value={secretKey}
          onChange={(e) => { setSecretKey(e.target.value); setTouched(true); }}
          style={{
            border: `2px solid ${touched ? (isValid ? '#22c55e' : '#ef4444') : '#ccc'}`,
          }}
          aria-label={t('importAccount.secretKeyAriaLabel')}
          autoComplete="off"
        />
        {touched && <span className="input-icon">{isValid ? '✅' : '❌'}</span>}
      </div>
      {touched && !isValid && (
        <p className="field-error">{t('importAccount.invalidSecretKey')}</p>
      )}
      <motion.button
        type="submit"
        disabled={!isValid || loading === 'import'}
        whileTap={{ scale: 0.97 }}
      >
        {t('account.import')} {loading === 'import' && '⟳'}
      </motion.button>
    </form>
  );
}
