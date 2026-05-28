import { useState } from 'react';
import axios from 'axios';

const ASSETS = ['XLM', 'USDC', 'BTC', 'ETH'];

/**
 * Asset conversion calculator using /api/stellar/convert/:from/:to/:amount.
 */
export function ConvertWidget() {
  const [from, setFrom] = useState('XLM');
  const [to, setTo] = useState('USDC');
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const convert = async () => {
    if (!amount || isNaN(amount) || Number(amount) <= 0) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const { data } = await axios.get(`/api/stellar/convert/${from}/${to}/${amount}`);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error ?? err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="section" aria-labelledby="convert-heading">
      <h2 id="convert-heading">Convert</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label htmlFor="convert-amount" className="sr-only">Amount</label>
          <input
            id="convert-amount"
            type="number"
            inputMode="decimal"
            min="0"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && convert()}
            style={{ width: 120 }}
            aria-label="Amount to convert"
          />
        </div>
        <div>
          <label htmlFor="convert-from" className="sr-only">From asset</label>
          <select id="convert-from" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From asset">
            {ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <span aria-hidden="true">→</span>
        <div>
          <label htmlFor="convert-to" className="sr-only">To asset</label>
          <select id="convert-to" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To asset">
            {ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button type="button" onClick={convert} disabled={loading || !amount} aria-busy={loading}>
          {loading ? '…' : 'Convert'}
        </button>
      </div>

      {error && <p role="alert" style={{ color: '#ef4444', marginTop: 8 }}>{error}</p>}

      {result && (
        <p style={{ marginTop: 8 }} aria-live="polite">
          <strong>{result.amount} {result.from}</strong> = <strong>{Number(result.converted).toFixed(7)} {result.to}</strong>
        </p>
      )}
    </section>
  );
}
