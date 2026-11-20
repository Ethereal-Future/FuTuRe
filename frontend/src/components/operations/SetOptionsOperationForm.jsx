import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StrKey } from '@stellar/stellar-base';

// Stellar protocol: home_domain is a string32 (max 32 bytes, not characters).
export const HOME_DOMAIN_MAX_BYTES = 32;

export function utf8ByteLength(value) {
  return new TextEncoder().encode(value).length;
}

// AccountFlags bit values from the Stellar protocol.
const ACCOUNT_FLAGS = [
  { bit: 1, labelKey: 'setOptionsForm.flagAuthRequired' },
  { bit: 2, labelKey: 'setOptionsForm.flagAuthRevocable' },
  { bit: 4, labelKey: 'setOptionsForm.flagAuthImmutable' },
  { bit: 8, labelKey: 'setOptionsForm.flagAuthClawback' },
];

const sumBits = (bits) => bits.reduce((acc, b) => acc | b, 0);
const toggleBit = (bits, bit) => (bits.includes(bit) ? bits.filter((b) => b !== bit) : [...bits, bit]);

export function SetOptionsOperationForm({ onAdd, publicKey }) {
  const { t } = useTranslation();
  const [inflationDest, setInflationDest] = useState('');
  const [clearFlags, setClearFlags] = useState([]);
  const [setFlags, setSetFlags] = useState([]);
  const [masterWeight, setMasterWeight] = useState('');
  const [lowThreshold, setLowThreshold] = useState('');
  const [medThreshold, setMedThreshold] = useState('');
  const [highThreshold, setHighThreshold] = useState('');
  const [homeDomain, setHomeDomain] = useState('');
  const [signerAction, setSignerAction] = useState('none');
  const [signerKey, setSignerKey] = useState('');
  const [signerWeight, setSignerWeight] = useState('1');
  const [error, setError] = useState('');

  const homeDomainBytes = utf8ByteLength(homeDomain);
  const homeDomainTooLong = homeDomainBytes > HOME_DOMAIN_MAX_BYTES;

  const validateThresholds = () => {
    const med = medThreshold ? parseInt(medThreshold) : null;
    const high = highThreshold ? parseInt(highThreshold) : null;

    if (med !== null && high !== null && med > high) {
      setError(t('setOptionsForm.medExceedsHigh'));
      return false;
    }

    return true;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!validateThresholds()) {
      return;
    }

    const data = {};

    if (inflationDest) {
      if (inflationDest === publicKey) {
        setError(t('setOptionsForm.selfInflationError'));
        return;
      }
      data.inflationDest = inflationDest;
    }

    if (setFlags.some((bit) => clearFlags.includes(bit))) {
      setError(t('setOptionsForm.flagConflict'));
      return;
    }

    if (clearFlags.length > 0) {
      data.clearFlags = sumBits(clearFlags);
    }

    if (setFlags.length > 0) {
      data.setFlags = sumBits(setFlags);
    }

    if (masterWeight !== '' && masterWeight !== null) {
      const num = parseInt(masterWeight);
      if (isNaN(num) || num < 0 || num > 255) {
        setError(t('setOptionsForm.invalidMasterWeight'));
        return;
      }
      data.masterWeight = num;
    }

    if (lowThreshold !== '' && lowThreshold !== null) {
      const num = parseInt(lowThreshold);
      if (isNaN(num) || num < 0 || num > 255) {
        setError(t('setOptionsForm.invalidLowThreshold'));
        return;
      }
      data.lowThreshold = num;
    }

    if (medThreshold !== '' && medThreshold !== null) {
      const num = parseInt(medThreshold);
      if (isNaN(num) || num < 0 || num > 255) {
        setError(t('setOptionsForm.invalidMedThreshold'));
        return;
      }
      data.medThreshold = num;
    }

    if (highThreshold !== '' && highThreshold !== null) {
      const num = parseInt(highThreshold);
      if (isNaN(num) || num < 0 || num > 255) {
        setError(t('setOptionsForm.invalidHighThreshold'));
        return;
      }
      data.highThreshold = num;
    }

    if (homeDomain) {
      if (homeDomainTooLong) {
        setError(t('setOptionsForm.homeDomainTooLong', { bytes: homeDomainBytes }));
        return;
      }
      data.homeDomain = homeDomain;
    }

    if (signerAction !== 'none') {
      const key = signerKey.trim();
      if (!StrKey.isValidEd25519PublicKey(key)) {
        setError(t('setOptionsForm.invalidSignerKey'));
        return;
      }
      if (publicKey && key === publicKey) {
        setError(t('setOptionsForm.signerIsMaster'));
        return;
      }
      let weight = 0;
      if (signerAction === 'add') {
        weight = parseInt(signerWeight, 10);
        if (isNaN(weight) || weight < 1 || weight > 255) {
          setError(t('setOptionsForm.invalidSignerWeight'));
          return;
        }
      }
      // A signer with weight 0 is removed from the account.
      data.signer = { ed25519PublicKey: key, weight };
    }

    if (Object.keys(data).length === 0) {
      setError(t('setOptionsForm.noOptionSet'));
      return;
    }

    onAdd(data);

    setInflationDest('');
    setClearFlags([]);
    setSetFlags([]);
    setMasterWeight('');
    setLowThreshold('');
    setMedThreshold('');
    setHighThreshold('');
    setHomeDomain('');
    setSignerAction('none');
    setSignerKey('');
    setSignerWeight('1');
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <p role="alert" style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 8 }}>
          {error}
        </p>
      )}

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="inflation-dest" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          {t('setOptionsForm.inflationDestLabel')}
        </label>
        <input
          id="inflation-dest"
          type="text"
          value={inflationDest}
          onChange={(e) => setInflationDest(e.target.value)}
          placeholder="G..."
          style={{ width: '100%' }}
        />
      </div>

      <fieldset style={{ marginBottom: 8, border: '1px solid #d1d5db', borderRadius: 4, padding: 8 }}>
        <legend style={{ fontSize: '0.85rem' }}>{t('setOptionsForm.flagsLegend')}</legend>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '4px 12px', alignItems: 'center', fontSize: '0.85rem' }}>
          <span />
          <span>{t('setOptionsForm.flagSet')}</span>
          <span>{t('setOptionsForm.flagClear')}</span>
          {ACCOUNT_FLAGS.map(({ bit, labelKey }) => (
            <div key={bit} style={{ display: 'contents' }}>
              <span id={`flag-label-${bit}`}>{t(labelKey)}</span>
              <input
                type="checkbox"
                id={`set-flag-${bit}`}
                aria-label={`${t('setOptionsForm.flagSet')}: ${t(labelKey)}`}
                checked={setFlags.includes(bit)}
                onChange={() => setSetFlags((prev) => toggleBit(prev, bit))}
              />
              <input
                type="checkbox"
                id={`clear-flag-${bit}`}
                aria-label={`${t('setOptionsForm.flagClear')}: ${t(labelKey)}`}
                checked={clearFlags.includes(bit)}
                onChange={() => setClearFlags((prev) => toggleBit(prev, bit))}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="master-weight" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          {t('setOptionsForm.masterWeightLabel')}
        </label>
        <input
          id="master-weight"
          type="number"
          value={masterWeight}
          onChange={(e) => setMasterWeight(e.target.value)}
          placeholder="1"
          min="0"
          max="255"
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <div>
          <label htmlFor="low-threshold" style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>
            {t('setOptionsForm.lowThresholdLabel')}
          </label>
          <input
            id="low-threshold"
            type="number"
            value={lowThreshold}
            onChange={(e) => setLowThreshold(e.target.value)}
            placeholder="0"
            min="0"
            max="255"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label htmlFor="med-threshold" style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>
            {t('setOptionsForm.medThresholdLabel')}
          </label>
          <input
            id="med-threshold"
            type="number"
            value={medThreshold}
            onChange={(e) => setMedThreshold(e.target.value)}
            placeholder="0"
            min="0"
            max="255"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label htmlFor="high-threshold" style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>
            {t('setOptionsForm.highThresholdLabel')}
          </label>
          <input
            id="high-threshold"
            type="number"
            value={highThreshold}
            onChange={(e) => setHighThreshold(e.target.value)}
            placeholder="0"
            min="0"
            max="255"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="home-domain" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          {t('setOptionsForm.homeDomainLabel')}
        </label>
        <input
          id="home-domain"
          type="text"
          value={homeDomain}
          onChange={(e) => setHomeDomain(e.target.value)}
          placeholder="example.com"
          maxLength={HOME_DOMAIN_MAX_BYTES}
          aria-invalid={homeDomainTooLong}
          aria-describedby="home-domain-bytes"
          style={{ width: '100%', borderColor: homeDomainTooLong ? '#ef4444' : undefined }}
        />
        <small
          id="home-domain-bytes"
          style={{ display: 'block', fontSize: '0.75rem', color: homeDomainTooLong ? '#ef4444' : '#6b7280' }}
        >
          {homeDomainTooLong
            ? t('setOptionsForm.homeDomainTooLong', { bytes: homeDomainBytes })
            : t('setOptionsForm.homeDomainBytes', { bytes: homeDomainBytes })}
        </small>
      </div>

      <fieldset style={{ marginBottom: 8, border: '1px solid #d1d5db', borderRadius: 4, padding: 8 }}>
        <legend style={{ fontSize: '0.85rem' }}>{t('setOptionsForm.signerLegend')}</legend>
        <select
          id="signer-action"
          aria-label={t('setOptionsForm.signerLegend')}
          value={signerAction}
          onChange={(e) => setSignerAction(e.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        >
          <option value="none">{t('setOptionsForm.signerActionNone')}</option>
          <option value="add">{t('setOptionsForm.signerActionAdd')}</option>
          <option value="remove">{t('setOptionsForm.signerActionRemove')}</option>
        </select>

        {signerAction !== 'none' && (
          <div style={{ display: 'grid', gridTemplateColumns: signerAction === 'add' ? '3fr 1fr' : '1fr', gap: 8 }}>
            <div>
              <label htmlFor="signer-key" style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>
                {t('setOptionsForm.signerKeyLabel')}
              </label>
              <input
                id="signer-key"
                type="text"
                value={signerKey}
                onChange={(e) => setSignerKey(e.target.value)}
                placeholder="G..."
                style={{ width: '100%' }}
              />
            </div>
            {signerAction === 'add' && (
              <div>
                <label htmlFor="signer-weight" style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>
                  {t('setOptionsForm.signerWeightLabel')}
                </label>
                <input
                  id="signer-weight"
                  type="number"
                  value={signerWeight}
                  onChange={(e) => setSignerWeight(e.target.value)}
                  min="1"
                  max="255"
                  style={{ width: '100%' }}
                />
              </div>
            )}
          </div>
        )}
      </fieldset>

      <button type="submit" style={{ width: '100%', marginTop: 8 }}>
        {t('setOptionsForm.submit')}
      </button>
    </form>
  );
}
