import { useState } from 'react';
import apiClient from '../api/client.js';

const STELLAR_PUBLIC_KEY = /^G[A-Z2-7]{55}$/;

const STEP_WARN = 'warn';
const STEP_DEST = 'dest';
const STEP_CONFIRM = 'confirm';
const STEP_PASSWORD = 'password';

export function AccountMerge({ sourceSecret, onClose, onSuccess, xlmAmount = null }) {
  const [step, setStep] = useState(STEP_WARN);
  const [destination, setDestination] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isValidDestination = STELLAR_PUBLIC_KEY.test(destination);
  const isConfirmed = confirmText.toUpperCase() === 'MERGE';
  const isPasswordValid = password.length >= 1;

  const handleNext = () => {
    switch (step) {
      case STEP_WARN:
        setStep(STEP_DEST);
        break;
      case STEP_DEST:
        if (isValidDestination) {
          setStep(STEP_CONFIRM);
        }
        break;
      case STEP_CONFIRM:
        if (isConfirmed) {
          setStep(STEP_PASSWORD);
        }
        break;
      default:
        break;
    }
  };

  const handlePrev = () => {
    if (step === STEP_DEST) setStep(STEP_WARN);
    else if (step === STEP_CONFIRM) setStep(STEP_DEST);
    else if (step === STEP_PASSWORD) setStep(STEP_CONFIRM);
  };

  const handleMerge = async () => {
    if (!isValidDestination || !isConfirmed || !isPasswordValid) return;

    setLoading(true);
    setError(null);

    try {
      const { data } = await apiClient.post('/api/stellar/account/merge', {
        sourceSecret,
        destination,
        password,
      });
      onSuccess?.(data);
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setLoading(false);
    }
  };

  const stepNumber = {
    [STEP_WARN]: 1,
    [STEP_DEST]: 2,
    [STEP_CONFIRM]: 3,
    [STEP_PASSWORD]: 4,
  }[step];

  return (
    <div
      className="replay-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="merge-title"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="replay-modal" style={{ maxWidth: 520, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 id="merge-title" style={{ margin: 0, color: '#dc2626' }}>
            ⚠️ Merge Account (Step {stepNumber}/4)
          </h2>
          <button type="button" className="qr-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Step 1: Warning */}
        {step === STEP_WARN && (
          <>
            <div
              role="alert"
              style={{
                background: '#fef2f2',
                border: '2px solid #dc2626',
                borderRadius: 8,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, color: '#dc2626', marginBottom: 12, fontSize: '1rem' }}>
                ⚠️ CRITICAL WARNING: This action is IRREVERSIBLE
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#991b1b', lineHeight: 1.6 }}>
                <li><strong>All funds will be transferred</strong> to the destination account</li>
                <li><strong>Your source account will be permanently closed</strong></li>
                <li><strong>You will lose access forever</strong> to this account</li>
                <li><strong>This operation CANNOT be undone</strong> once submitted</li>
                {xlmAmount && <li><strong>Total XLM to transfer: {xlmAmount}</strong></li>}
              </ul>
            </div>
            <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: 20 }}>
              Proceed only if you understand the consequences and have backed up your secret key.
            </p>
          </>
        )}

        {/* Step 2: Destination */}
        {step === STEP_DEST && (
          <div style={{ marginBottom: 20 }}>
            <label htmlFor="destination" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Enter Destination Account Public Key
            </label>
            <input
              id="destination"
              type="text"
              value={destination}
              onChange={e => setDestination(e.target.value.trim())}
              placeholder="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
              autoFocus
              style={{
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                borderColor: destination && !isValidDestination ? '#dc2626' : undefined,
                width: '100%',
              }}
            />
            {destination && !isValidDestination && (
              <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '4px 0 0' }}>
                Invalid Stellar public key format
              </p>
            )}
            {destination && isValidDestination && (
              <p style={{ color: '#16a34a', fontSize: '0.85rem', margin: '4px 0 0' }}>
                ✓ Valid public key
              </p>
            )}
          </div>
        )}

        {/* Step 3: Type "MERGE" */}
        {step === STEP_CONFIRM && (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#991b1b' }}>
                🚨 Type <strong>"MERGE"</strong> to confirm you understand this is irreversible
              </p>
            </div>
            <label htmlFor="confirm" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Confirmation (type "MERGE")
            </label>
            <input
              id="confirm"
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="MERGE"
              autoFocus
              style={{
                borderColor: confirmText && !isConfirmed ? '#dc2626' : undefined,
                width: '100%',
              }}
            />
            {confirmText && !isConfirmed && (
              <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '4px 0 0' }}>
                Must type exactly "MERGE"
              </p>
            )}
          </div>
        )}

        {/* Step 4: Re-enter Password */}
        {step === STEP_PASSWORD && (
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                background: '#fef3c7',
                border: '1px solid #fcd34d',
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#78350f' }}>
                🔐 For security, re-enter your password to confirm
              </p>
            </div>
            <label htmlFor="password" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoFocus
              style={{ width: '100%' }}
            />
          </div>
        )}

        {error && (
          <p role="alert" style={{ color: '#dc2626', marginBottom: 16, fontWeight: 500 }}>
            Error: {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <button
            type="button"
            onClick={handlePrev}
            disabled={step === STEP_WARN}
            className="btn-secondary"
          >
            ← Back
          </button>

          {step === STEP_PASSWORD ? (
            <button
              type="button"
              onClick={handleMerge}
              disabled={!isPasswordValid || loading}
              style={{
                background: '#dc2626',
                opacity: !isPasswordValid || loading ? 0.5 : 1,
              }}
            >
              {loading ? 'Merging…' : '🔥 MERGE ACCOUNT (FINAL)'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleNext}
              disabled={
                (step === STEP_DEST && !isValidDestination) ||
                (step === STEP_CONFIRM && !isConfirmed)
              }
            >
              Continue →
            </button>
          )}

          <button type="button" className="btn-clear" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
