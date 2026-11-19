import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';
import { simulateAccountMerge, stroopsToXLM } from '../utils/accountMergeSimulation.js';
import { formatAssetAmount } from '../utils/formatAmount';
import { isValidStellarAddress } from '../utils/validateStellarAddress';

export const MERGE_CONFIRM_WORD = 'MERGE';
// Number of trailing destination characters the user must re-type.
const ADDRESS_CHECK_LENGTH = 6;
const IRREVERSIBLE_WARNING =
  'This action is permanent and cannot be undone. Your current account will be permanently deleted from the Stellar ledger.';

const STEP_WARN = 'warn';
const STEP_DEST = 'dest';
const STEP_SIMULATE = 'simulate';
const STEP_CONFIRM = 'confirm';
const STEP_PASSWORD = 'password';

export function AccountMerge({ sourceSecret, sourcePublicKey, onClose, onSuccess, xlmAmount = null }) {
  const [step, setStep] = useState(STEP_WARN);
  const [destination, setDestination] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [simulationResult, setSimulationResult] = useState(null);
  const [simLoading, setSimLoading] = useState(false);
  const [understoodRisks, setUnderstoodRisks] = useState(false);
  const [addressCheck, setAddressCheck] = useState('');

  // Full StrKey validation (base32 + CRC16 checksum), not just a shape regex.
  const isValidDestination = isValidStellarAddress(destination);
  const isSelfMerge = destination === sourcePublicKey;
  const destinationSuffix = destination.slice(-ADDRESS_CHECK_LENGTH);
  const isAddressChecked = addressCheck.trim().toUpperCase() === destinationSuffix;
  // Exact, case-sensitive match required.
  const isConfirmed = confirmText === MERGE_CONFIRM_WORD && isAddressChecked;
  const isPasswordValid = password.length >= 1;

  const handleNext = async () => {
    switch (step) {
      case STEP_WARN:
        setStep(STEP_DEST);
        break;
      case STEP_DEST:
        if (isValidDestination && !isSelfMerge) {
          await runSimulation();
        }
        break;
      case STEP_SIMULATE:
        if (understoodRisks && simulationResult?.valid) {
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

  const runSimulation = async () => {
    setSimLoading(true);
    setError(null);
    try {
      const result = await simulateAccountMerge(sourcePublicKey, destination);
      setSimulationResult(result);
      setUnderstoodRisks(false);
      setConfirmText('');
      setAddressCheck('');
      setStep(STEP_SIMULATE);
    } catch (err) {
      setError(err?.message || 'Failed to simulate account merge');
    } finally {
      setSimLoading(false);
    }
  };

  const handlePrev = () => {
    if (step === STEP_DEST) setStep(STEP_WARN);
    else if (step === STEP_SIMULATE) setStep(STEP_DEST);
    else if (step === STEP_CONFIRM) setStep(STEP_SIMULATE);
    else if (step === STEP_PASSWORD) setStep(STEP_CONFIRM);
  };

  const handleMerge = async () => {
    if (!isValidDestination || isSelfMerge || !simulationResult?.valid || !isConfirmed || !isPasswordValid) return;

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
    [STEP_SIMULATE]: 3,
    [STEP_CONFIRM]: 4,
    [STEP_PASSWORD]: 5,
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
            ⚠️ Merge Account (Step {stepNumber}/5)
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
              <p style={{ margin: '0 0 12px', fontWeight: 600, color: '#991b1b' }}>
                {IRREVERSIBLE_WARNING}
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
              <p role="alert" style={{ color: '#dc2626', fontSize: '0.85rem', margin: '4px 0 0' }}>
                Invalid Stellar public key (format or checksum mismatch)
              </p>
            )}
            {destination && isValidDestination && isSelfMerge && (
              <p role="alert" style={{ color: '#dc2626', fontSize: '0.85rem', margin: '4px 0 0' }}>
                Destination must be different from the account being merged
              </p>
            )}
            {destination && isValidDestination && !isSelfMerge && (
              <p style={{ color: '#16a34a', fontSize: '0.85rem', margin: '4px 0 0' }}>
                ✓ Valid public key checksum — on-chain existence will be verified next
              </p>
            )}
          </div>
        )}

        {/* Step 3: Merge Simulation */}
        {step === STEP_SIMULATE && simulationResult && (
          <div style={{ marginBottom: 20 }}>
            {simulationResult.error && (
              <p role="alert" style={{ color: '#dc2626', marginBottom: 16, fontWeight: 500 }}>
                Could not verify merge: {simulationResult.error}
              </p>
            )}
            {simulationResult.blockedReasons.length > 0 && (
              <div
                style={{
                  background: '#fee2e2',
                  border: '2px solid #dc2626',
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 16,
                }}
              >
                <p style={{ margin: '0 0 8px 0', fontWeight: 600, color: '#991b1b' }}>
                  ❌ Cannot merge this account
                </p>
                <ul style={{ margin: 0, paddingLeft: 20, color: '#991b1b', fontSize: '0.9rem' }}>
                  {simulationResult.blockedReasons.map((reason, i) => (
                    <li key={i}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}

            {simulationResult.warning && (
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
                  ⚠️ {simulationResult.warning}
                </p>
              </div>
            )}

            <div style={{ background: '#f0f9ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#1e40af', fontWeight: 600 }}>
                📊 Simulation Results
              </p>
              <dl style={{ margin: 0, fontSize: '0.85rem', color: '#1e40af' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt>XLM to transfer</dt>
                  <dd style={{ fontWeight: 600 }}>{formatAssetAmount(simulationResult.xlmToTransfer)} XLM</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt>Destination account</dt>
                  <dd style={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all' }}>
                    {destination}
                  </dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt>Subentries</dt>
                  <dd>{simulationResult.subentryCount}</dd>
                </div>
              </dl>
            </div>

            {simulationResult.trustlines.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <p style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 8 }}>
                  Trustlines ({simulationResult.trustlines.length}):
                </p>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.85rem' }}>
                  {simulationResult.trustlines.map((tl, i) => (
                    <li key={i}>{tl.asset_code} {tl.balance}</li>
                  ))}
                </ul>
              </div>
            )}

            {simulationResult.valid && (
              <div style={{
                background: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.9rem', color: '#166534', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={understoodRisks}
                    onChange={e => setUnderstoodRisks(e.target.checked)}
                    style={{ marginTop: 2, cursor: 'pointer' }}
                  />
                  <span>
                    I understand this operation is <strong>irreversible</strong> and will permanently close this account.
                    I have removed all trustlines and offers. I have backed up my secret key.
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Type "MERGE" + confirm destination */}
        {step === STEP_CONFIRM && (
          <div style={{ marginBottom: 20 }}>
            <div
              role="alert"
              style={{
                background: '#fee2e2',
                border: '2px solid #dc2626',
                borderRadius: 8,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <p style={{ margin: '0 0 8px', fontSize: '0.95rem', color: '#991b1b', fontWeight: 700 }}>
                🚨 {IRREVERSIBLE_WARNING}
              </p>
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#991b1b' }}>
                Type <strong>"{MERGE_CONFIRM_WORD}"</strong> and the last {ADDRESS_CHECK_LENGTH} characters of the
                destination address to continue.
              </p>
            </div>
            <p style={{ fontSize: '0.85rem', margin: '0 0 4px', fontWeight: 600 }}>Destination</p>
            <p
              data-testid="merge-destination"
              style={{ fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all', margin: '0 0 12px' }}
            >
              {destination.slice(0, -ADDRESS_CHECK_LENGTH)}
              <strong style={{ color: '#dc2626' }}>{destinationSuffix}</strong>
            </p>
            <label htmlFor="address-check" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Last {ADDRESS_CHECK_LENGTH} characters of destination
            </label>
            <input
              id="address-check"
              type="text"
              value={addressCheck}
              onChange={e => setAddressCheck(e.target.value)}
              maxLength={ADDRESS_CHECK_LENGTH}
              autoComplete="off"
              spellCheck={false}
              style={{
                fontFamily: 'monospace',
                borderColor: addressCheck && !isAddressChecked ? '#dc2626' : undefined,
                width: '100%',
                marginBottom: 12,
              }}
            />
            {addressCheck.length === ADDRESS_CHECK_LENGTH && !isAddressChecked && (
              <p style={{ color: '#dc2626', fontSize: '0.85rem', margin: '-8px 0 12px' }}>
                Does not match the destination address
              </p>
            )}
            <label htmlFor="confirm" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Confirmation (type "MERGE")
            </label>
            <input
              id="confirm"
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={MERGE_CONFIRM_WORD}
              autoComplete="off"
              style={{
                borderColor: confirmText && confirmText !== MERGE_CONFIRM_WORD ? '#dc2626' : undefined,
                width: '100%',
              }}
            />
            {confirmText && confirmText !== MERGE_CONFIRM_WORD && (
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
                (step === STEP_DEST && (!isValidDestination || isSelfMerge || simLoading)) ||
                (step === STEP_SIMULATE && (!understoodRisks || !simulationResult?.valid)) ||
                (step === STEP_CONFIRM && !isConfirmed)
              }
            >
              {step === STEP_DEST && simLoading ? 'Simulating…' : 'Continue →'}
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
