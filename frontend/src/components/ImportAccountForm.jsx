import { useState } from 'react';
import { motion } from 'framer-motion';

const STELLAR_SECRET_KEY = /^S[A-Z2-7]{55}$/;

export function ImportAccountForm({ onImport, loading }) {
  const [secretKey, setSecretKey] = useState('');
  const [touched, setTouched] = useState(false);

  const isValid = STELLAR_SECRET_KEY.test(secretKey.trim());

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid) return;
    onImport(secretKey.trim());
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
        ⚠️ Never share your secret key. It will not be stored and will be cleared after import.
      </div>
      <div className="input-wrap">
        <input
          type="password"
          placeholder="Secret Key (starts with S…)"
          value={secretKey}
          onChange={(e) => { setSecretKey(e.target.value); setTouched(true); }}
          style={{
            border: `2px solid ${touched ? (isValid ? '#22c55e' : '#ef4444') : '#ccc'}`,
          }}
          aria-label="Stellar secret key"
          autoComplete="off"
        />
        {touched && <span className="input-icon">{isValid ? '✅' : '❌'}</span>}
      </div>
      {touched && !isValid && (
        <p className="field-error">Invalid secret key (must start with S and be 56 characters)</p>
      )}
      <motion.button
        type="submit"
        disabled={!isValid || loading === 'import'}
        whileTap={{ scale: 0.97 }}
      >
        Import Account {loading === 'import' && '⟳'}
      </motion.button>
    </form>
  );
}
