import { useState } from 'react';

export function PaymentOperationForm({ onAdd, publicKey }) {
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  const [asset, setAsset] = useState('XLM');
  const [issuer, setIssuer] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!destination) {
      setError('Destination account required');
      return;
    }

    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      setError('Valid amount required');
      return;
    }

    if (asset !== 'XLM' && !issuer) {
      setError('Issuer required for non-XLM assets');
      return;
    }

    if (destination === publicKey) {
      setError('Cannot send to your own account');
      return;
    }

    onAdd({
      destination,
      amount: parseFloat(amount).toString(),
      asset: asset === 'XLM' ? { code: 'XLM' } : { code: asset, issuer },
      memo: memo || undefined,
    });

    setDestination('');
    setAmount('');
    setAsset('XLM');
    setIssuer('');
    setMemo('');
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <p role="alert" style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 8 }}>
          {error}
        </p>
      )}
      <div style={{ marginBottom: 8 }}>
        <label htmlFor="payment-destination" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          Destination Account
        </label>
        <input
          id="payment-destination"
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="G..."
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="payment-amount" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          Amount
        </label>
        <input
          id="payment-amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          step="0.0000001"
          min="0"
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label htmlFor="payment-asset" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
            Asset
          </label>
          <select
            id="payment-asset"
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="XLM">XLM</option>
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
            <option value="other">Other</option>
          </select>
        </div>

        {asset !== 'XLM' && (
          <div>
            <label htmlFor="payment-issuer" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
              Issuer
            </label>
            <input
              id="payment-issuer"
              type="text"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="G..."
              style={{ width: '100%' }}
            />
          </div>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="payment-memo" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          Memo (optional)
        </label>
        <input
          id="payment-memo"
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Memo text"
          style={{ width: '100%' }}
        />
      </div>

      <button type="submit" style={{ width: '100%', marginTop: 8 }}>
        Add Payment Operation
      </button>
    </form>
  );
}
