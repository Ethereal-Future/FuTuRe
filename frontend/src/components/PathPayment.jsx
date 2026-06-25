import { useState } from 'react';
import apiClient from '../api/client.js';
import { motion, AnimatePresence } from 'framer-motion';

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

export function PathPayment({ account }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [paths, setPaths] = useState(null);
  const [finding, setFinding] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [convertMode, setConvertMode] = useState(false);

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
                {form.sendAmount} {form.sourceAsset} = <strong>{parseFloat(bestPath.destinationAmount).toFixed(7)} {form.destAsset}</strong>
              </p>
              {bestPath.destinationAmount && form.sendAmount && (
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted, #64748b)' }}>
                  Rate: 1 {form.sourceAsset} = {(parseFloat(bestPath.destinationAmount) / parseFloat(form.sendAmount)).toFixed(7)} {form.destAsset}
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
