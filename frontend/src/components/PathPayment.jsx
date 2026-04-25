import { useState } from 'react';
import axios from 'axios';

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
      const { data } = await axios.post('/api/path-payment/paths', {
        sourceAsset: { code: form.sourceAsset },
        sourceAmount: form.sendAmount,
        destinationAsset: { code: form.destAsset },
        destinationAccount: form.destination || undefined,
      });
      setPaths(data.paths);
      if (!data.paths.length) setError('No paths found between these assets.');
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
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
      const { data } = await axios.post('/api/path-payment/send', {
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
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="section" aria-labelledby="path-payment-heading">
      <h2 id="path-payment-heading">Path Payment (Cross-Asset)</h2>

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
          <span style={{ alignSelf: 'center' }}>→</span>
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

        <button type="submit" disabled={finding || !form.sendAmount || !form.destination}>
          {finding ? 'Finding paths…' : 'Find Best Rate'}
        </button>
      </form>

      {error && (
        <p role="alert" style={{ color: '#ef4444', marginTop: 8 }}>{error}</p>
      )}

      {success && (
        <p role="status" style={{ color: '#22c55e', marginTop: 8 }}>{success}</p>
      )}

      {bestPath && (
        <div
          style={{ marginTop: 12, padding: '10px 14px', background: 'var(--card-bg, #f8fafc)', borderRadius: 8, border: '1px solid var(--border, #e2e8f0)' }}
          aria-label="Best path rate"
        >
          <p style={{ margin: '0 0 4px' }}>
            <strong>Best rate:</strong>{' '}
            {form.sendAmount} {form.sourceAsset} → <strong>{parseFloat(bestPath.destinationAmount).toFixed(7)} {form.destAsset}</strong>
          </p>
          {bestPath.path.length > 0 && (
            <p style={{ margin: '0 0 8px', fontSize: '0.85rem', color: 'var(--text-muted, #64748b)' }}>
              Via: {bestPath.path.join(' → ')}
            </p>
          )}

          {!showConfirm ? (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={sending || !account?.secretKey}
              aria-label="Confirm and send path payment"
            >
              Send
            </button>
          ) : (
            <span role="group" aria-label="Confirm path payment">
              <span style={{ marginRight: 8 }}>Confirm send?</span>
              <button type="button" onClick={sendPayment} disabled={sending} style={{ marginRight: 6 }}>
                {sending ? 'Sending…' : 'Yes, send'}
              </button>
              <button type="button" className="btn-clear" onClick={() => setShowConfirm(false)}>Cancel</button>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
