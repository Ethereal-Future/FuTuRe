import { useState } from 'react';
import apiClient from '../api/client.js';
import { motion, AnimatePresence } from 'framer-motion';
import { formatAssetAmount } from '../utils/formatAmount';

const ASSETS = [
  { code: 'XLM', label: 'XLM (Stellar Lumens)' },
  { code: 'USDC', label: 'USDC' },
  { code: 'EURC', label: 'EURC' },
];

const DEFAULT_FORM = {
  sourceAsset: 'XLM',
  destAsset: 'USDC',
  sendAmount: '',
  destination: '',
};

// Preset slippage options (in percent). 'custom' lets the user type a value.
const SLIPPAGE_PRESETS = ['0.5', '1.0', '2.0', 'custom'];

// Default max transaction validity window in seconds (5 minutes).
const DEFAULT_TIMEBOUND_SECONDS = 300;

export function PathPayment({ account }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [paths, setPaths] = useState(null);
  const [finding, setFinding] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [convertMode, setConvertMode] = useState(false);

  // Slippage tolerance — one of '0.5' | '1.0' | '2.0' | 'custom'
  const [slippagePreset, setSlippagePreset] = useState('1.0');
  // Value used when slippagePreset === 'custom'
  const [customSlippage, setCustomSlippage] = useState('');
  // Max transaction validity window in seconds (default 5 min)
  const [timeboundSeconds, setTimeboundSeconds] = useState(String(DEFAULT_TIMEBOUND_SECONDS));

  /** Resolved slippage percentage as a number, or null when the custom field is invalid. */
  const resolvedSlippage =
    slippagePreset === 'custom'
      ? parseFloat(customSlippage) > 0 ? parseFloat(customSlippage) : null
      : parseFloat(slippagePreset);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const bestPath = paths?.[0] ?? null;

  const findPaths = async (e) => {
    e.preventDefault();
    setError(null);
    setPaths(null);
    setSuccess(null);
    setShowConfirm(false);
    if (!form.sendAmount || parseFloat(form.sendAmount) <= 0) {
      setError('Enter a valid send amount.');
      return;
    }
    if (form.sourceAsset === form.destAsset) {
      setError('Source and destination assets must differ.');
      return;
    }
    setFinding(true);
    try {
      const { data } = await apiClient.post('/api/path-payment/paths', {
        sourceAsset: { code: form.sourceAsset },
        sourceAmount: form.sendAmount,
        destinationAsset: { code: form.destAsset },
        destinationAccount: form.destination || undefined,
      });
      setPaths(data.paths);
      if (!data.paths.length) setError('No paths found between these assets.');
    } catch (err) {
      setError(err?.response?.data?.error ?? err.message);
    } finally {
      setFinding(false);
    }
  };

  const sendPayment = async () => {
    if (!account?.secretKey || !bestPath) return;

    // Validate slippage before submitting.
    if (resolvedSlippage === null || resolvedSlippage <= 0 || resolvedSlippage > 100) {
      setError('Enter a valid slippage tolerance (e.g. 0.5).');
      return;
    }

    // Validate timebound.
    const tbSeconds = parseInt(timeboundSeconds, 10);
    if (!tbSeconds || tbSeconds <= 0) {
      setError('Enter a valid transaction time limit in seconds.');
      return;
    }

    setSending(true);
    setError(null);
    setShowConfirm(false);
    try {
      const { data } = await apiClient.post('/api/path-payment/send', {
        sourceSecret: account.secretKey,
        destination: form.destination,
        sendAsset: { code: form.sourceAsset },
        sendAmount: form.sendAmount,
        destAsset: { code: form.destAsset },
        path: bestPath.path.map(code => ({ code })),
        // Slippage tolerance as a percentage (e.g. 1.0 → 1 %).
        slippageTolerance: resolvedSlippage,
        // Unix timestamp after which the transaction is rejected by the network.
        maxTimeBound: Math.floor(Date.now() / 1000) + tbSeconds,
      });
      setSuccess(`Sent! Hash: ${data.hash.slice(0, 8)}…`);
      setForm(DEFAULT_FORM);
      setPaths(null);
    } catch (err) {
      setError(err?.response?.data?.error ?? err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="section" aria-labelledby="path-payment-heading">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 id="path-payment-heading" style={{ margin: 0 }}>Path Payment (Cross-Asset)</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500 }}>
          <input
            type="checkbox"
            checked={convertMode}
            onChange={(e) => {
              setConvertMode(e.target.checked);
              setError(null);
              setPaths(null);
              setSuccess(null);
            }}
            aria-label="Enable Convert & Send mode"
          />
          Convert &amp; Send
        </label>
      </div>

      <form onSubmit={findPaths} noValidate>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <div>
            <label htmlFor="pp-src-asset" className="sr-only">Source asset</label>
            <select
              id="pp-src-asset"
              value={form.sourceAsset}
              onChange={e => set('sourceAsset', e.target.value)}
              aria-label="Source asset"
            >
              {ASSETS.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
            </select>
          </div>
          <span style={{ alignSelf: 'center' }} aria-hidden="true">→</span>
          <div>
            <label htmlFor="pp-dst-asset" className="sr-only">Destination asset</label>
            <select
              id="pp-dst-asset"
              value={form.destAsset}
              onChange={e => set('destAsset', e.target.value)}
              aria-label="Destination asset"
            >
              {ASSETS.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
            </select>
          </div>
        </div>

        <div className="input-wrap" style={{ marginBottom: 8 }}>
          <label htmlFor="pp-amount" className="sr-only">Send amount</label>
          <input
            id="pp-amount"
            type="text"
            inputMode="decimal"
            placeholder={`Amount (${form.sourceAsset})`}
            value={form.sendAmount}
            onChange={e => set('sendAmount', e.target.value.replace(/[^0-9.]/g, ''))}
            aria-label={`Send amount in ${form.sourceAsset}`}
          />
        </div>

        <div className="input-wrap" style={{ marginBottom: 8 }}>
          <label htmlFor="pp-dest" className="sr-only">Destination account</label>
          <input
            id="pp-dest"
            type="text"
            placeholder="Destination Public Key (G…)"
            value={form.destination}
            onChange={e => set('destination', e.target.value.trim())}
            aria-label="Destination public key"
          />
        </div>

        {/* Slippage tolerance */}
        <fieldset style={{ margin: '8px 0', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 6 }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: '#374151', padding: '0 4px' }}>
            Slippage Tolerance
          </legend>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
            {SLIPPAGE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setSlippagePreset(preset)}
                aria-pressed={slippagePreset === preset}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: `1px solid ${slippagePreset === preset ? '#2563eb' : '#d1d5db'}`,
                  background: slippagePreset === preset ? '#eff6ff' : '#fff',
                  color: slippagePreset === preset ? '#1d4ed8' : '#374151',
                  cursor: 'pointer',
                }}
              >
                {preset === 'custom' ? 'Custom' : `${preset}%`}
              </button>
            ))}
            {slippagePreset === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 0.3"
                  value={customSlippage}
                  onChange={e => setCustomSlippage(e.target.value.replace(/[^0-9.]/g, ''))}
                  aria-label="Custom slippage percentage"
                  style={{ width: 72, padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 }}
                />
                <span style={{ fontSize: 12, color: '#6b7280' }}>%</span>
              </div>
            )}
          </div>
          {resolvedSlippage !== null && resolvedSlippage > 5 && (
            <p role="alert" style={{ margin: '6px 0 0', fontSize: 11, color: '#d97706' }}>
              ⚠ High slippage ({resolvedSlippage}%) — you may receive significantly fewer tokens.
            </p>
          )}
          <p style={{ margin: '6px 0 0', fontSize: 11, color: '#6b7280' }}>
            Maximum price movement you'll accept. Lower values protect against front-running.
          </p>
        </fieldset>

        {/* Transaction time limit (timebounds) */}
        <fieldset style={{ margin: '8px 0', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 6 }}>
          <legend style={{ fontSize: 12, fontWeight: 600, color: '#374151', padding: '0 4px' }}>
            Transaction Time Limit
          </legend>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <input
              type="number"
              min="30"
              max="3600"
              step="30"
              value={timeboundSeconds}
              onChange={e => setTimeboundSeconds(e.target.value)}
              aria-label="Transaction time limit in seconds"
              style={{ width: 80, padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 }}
            />
            <span style={{ fontSize: 12, color: '#6b7280' }}>seconds</span>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              ({timeboundSeconds && parseInt(timeboundSeconds, 10) > 0
                ? `expires in ${(parseInt(timeboundSeconds, 10) / 60).toFixed(1)} min`
                : 'invalid'})
            </span>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 11, color: '#6b7280' }}>
            If not confirmed within this window the transaction is rejected — protects against delayed sandwich attacks.
          </p>
        </fieldset>

        <button 
          type="submit" 
          disabled={finding || !form.sendAmount || !form.destination}
          aria-busy={finding}
        >
          {finding ? 'Finding paths…' : convertMode ? 'Check Conversion Rate' : 'Find Best Rate'}
        </button>
      </form>

      <AnimatePresence>
        {error && (
          <motion.p 
            role="alert" 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            style={{ color: '#ef4444', marginTop: 8 }}
          >
            {error}
          </motion.p>
        )}

        {success && (
          <motion.p 
            role="status" 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
            style={{ color: '#22c55e', marginTop: 8 }}
          >
            {success}
          </motion.p>
        )}

        {bestPath && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            style={{ marginTop: 12, padding: '12px 14px', background: 'var(--card-bg, #f8fafc)', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)' }}
            aria-label="Conversion rate and path details"
          >
            <div style={{ marginBottom: 8 }}>
              <p style={{ margin: '0 0 4px', fontSize: 13 }}>
                <strong>Conversion Rate:</strong>
              </p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#059669' }}>
                {form.sendAmount} {form.sourceAsset} = <strong>{formatAssetAmount(bestPath.destinationAmount)} {form.destAsset}</strong>
              </p>
              {bestPath.destinationAmount && form.sendAmount && (
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
                  Rate: 1 {form.sourceAsset} = {formatAssetAmount(parseFloat(bestPath.destinationAmount) / parseFloat(form.sendAmount))} {form.destAsset}
                </p>
              )}
            </div>

            {bestPath.path && bestPath.path.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <p style={{ margin: '0 0 4px', fontSize: 13 }}>
                  <strong>Conversion Path:</strong>
                </p>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
                  {form.sourceAsset} → {bestPath.path.join(' → ')} → {form.destAsset}
                </p>
              </div>
            )}

            <div style={{ marginBottom: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
                <strong>Slippage:</strong>{' '}
                {resolvedSlippage !== null ? `${resolvedSlippage}%` : <span style={{ color: '#ef4444' }}>not set</span>}
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
                <strong>Time limit:</strong>{' '}
                {parseInt(timeboundSeconds, 10) > 0
                  ? `${(parseInt(timeboundSeconds, 10) / 60).toFixed(1)} min`
                  : <span style={{ color: '#ef4444' }}>invalid</span>}
              </p>
            </div>

            {!showConfirm ? (
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={sending || !account?.secretKey}
                style={{ width: '100%', marginTop: 8 }}
                aria-label={`Confirm and send ${form.sendAmount} ${form.sourceAsset}`}
              >
                {sending ? 'Sending…' : convertMode ? 'Send Conversion' : 'Send Payment'}
              </button>
            ) : (
              <div style={{ marginTop: 8, padding: '8px', background: '#fee2e2', borderRadius: 4, display: 'flex', gap: 6 }}>
                <span style={{ fontSize: 12 }}>Confirm?</span>
                <button 
                  type="button" 
                  onClick={sendPayment} 
                  disabled={sending}
                  style={{ flex: 1, fontSize: 12, padding: '4px 8px' }}
                >
                  {sending ? 'Sending…' : 'Yes'}
                </button>
                <button 
                  type="button" 
                  onClick={() => setShowConfirm(false)}
                  style={{ flex: 1, fontSize: 12, padding: '4px 8px', background: '#e5e7eb' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
