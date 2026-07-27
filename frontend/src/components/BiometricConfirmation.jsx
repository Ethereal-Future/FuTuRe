import { useEffect, useState } from 'react';
import { verifyRecoveryCode } from '../api/auth.js';

const WEBAUTHN_SUPPORTED =
  typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';

/**
 * Gate shown before a large payment is confirmed. Asks for a WebAuthn
 * (Face ID / Touch ID / Windows Hello) confirmation that the person at the
 * device right now is physically present; devices without WebAuthn support
 * fall back to re-entering an MFA recovery code.
 */
export function BiometricConfirmation({ publicKey, amount, assetCode, onSuccess, onCancel }) {
  const [mode, setMode] = useState(WEBAUTHN_SUPPORTED ? 'biometric' : 'fallback');
  const [status, setStatus] = useState('idle'); // idle | verifying | error
  const [error, setError] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');

  // Devices without WebAuthn support skip straight to the fallback UI.
  useEffect(() => {
    if (!WEBAUTHN_SUPPORTED) setMode('fallback');
  }, []);

  const handleBiometricConfirm = async () => {
    setStatus('verifying');
    setError('');
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          timeout: 60000,
          userVerification: 'required',
        },
      });
      if (!assertion) throw new Error('No biometric assertion returned');
      onSuccess();
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Biometric confirmation failed or was cancelled.');
    }
  };

  const handleRecoverySubmit = async () => {
    setStatus('verifying');
    setError('');
    try {
      await verifyRecoveryCode(publicKey, recoveryCode);
      onSuccess();
    } catch (err) {
      setStatus('error');
      setError(err.response?.data?.error || 'Invalid recovery code.');
    }
  };

  return (
    <div className="replay-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="biometric-confirm-title">
      <div className="replay-modal" style={{ maxWidth: 380 }}>
        <h2 id="biometric-confirm-title">Confirm this payment</h2>
        <p>
          Sending {amount} {assetCode} is above your security threshold and needs an extra
          confirmation before it can be sent.
        </p>

        {mode === 'biometric' ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={handleBiometricConfirm}
                disabled={status === 'verifying'}
              >
                {status === 'verifying' ? 'Verifying…' : 'Confirm with biometrics'}
              </button>
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setMode('fallback');
                setStatus('idle');
                setError('');
              }}
              style={{
                marginTop: 12,
                background: 'none',
                border: 'none',
                textDecoration: 'underline',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              Use a recovery code instead
            </button>
          </>
        ) : (
          <>
            <label htmlFor="biometric-fallback-code">Recovery code</label>
            <input
              id="biometric-fallback-code"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.trim())}
              aria-label="Recovery code"
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={handleRecoverySubmit}
                disabled={status === 'verifying' || recoveryCode.length === 0}
              >
                {status === 'verifying' ? 'Verifying…' : 'Confirm'}
              </button>
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {status === 'error' && (
          <p role="alert" style={{ color: '#ef4444', marginTop: 12 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
