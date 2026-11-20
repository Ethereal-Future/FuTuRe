import { useEffect, useState } from 'react';
import {
  verifyRecoveryCode,
  getWebAuthnChallenge,
  verifyWebAuthnAssertion,
} from '../api/auth.js';

const WEBAUTHN_SUPPORTED =
  typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined';

/**
 * Decode a base64url-encoded string (as issued by the backend) into a
 * Uint8Array suitable for the WebAuthn API.
 */
function base64UrlToUint8Array(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode an ArrayBuffer as base64url so it can be sent to the backend for
 * server-side verification.
 */
function arrayBufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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
      // The challenge is issued and later verified by the backend; never
      // generate it client-side, otherwise a mocked assertion would pass.
      const options = await getWebAuthnChallenge(publicKey);
      const {
        challenge,
        challengeId,
        allowCredentials,
        rpId,
        timeout,
        userVerification,
      } = options || {};
      if (!challenge || !challengeId) {
        throw new Error('Server did not return a valid WebAuthn challenge');
      }

      const publicKeyOptions = {
        challenge: base64UrlToUint8Array(challenge),
        timeout: typeof timeout === 'number' ? timeout : 60000,
        userVerification: userVerification || 'required',
      };
      if (rpId) publicKeyOptions.rpId = rpId;
      if (Array.isArray(allowCredentials) && allowCredentials.length > 0) {
        publicKeyOptions.allowCredentials = allowCredentials.map((cred) => ({
          ...cred,
          id: typeof cred.id === 'string' ? base64UrlToUint8Array(cred.id) : cred.id,
        }));
      }

      const assertion = await navigator.credentials.get({ publicKey: publicKeyOptions });
      if (!assertion) throw new Error('No biometric assertion returned');

      const response = assertion.response;
      const result = await verifyWebAuthnAssertion(publicKey, {
        challengeId,
        id: assertion.id,
        rawId: arrayBufferToBase64Url(assertion.rawId),
        type: assertion.type,
        clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
        authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
        signature: arrayBufferToBase64Url(response.signature),
        userHandle: response.userHandle
          ? arrayBufferToBase64Url(response.userHandle)
          : null,
      });

      if (!result || result.verified !== true) {
        throw new Error(result?.error || 'Biometric assertion could not be verified');
      }
      onSuccess();
    } catch (err) {
      setStatus('error');
      setError(
        err.response?.data?.error ||
          err.message ||
          'Biometric confirmation failed or was cancelled.',
      );
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
