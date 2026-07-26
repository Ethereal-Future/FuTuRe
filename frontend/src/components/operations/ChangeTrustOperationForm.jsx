import { useState } from 'react';

export function ChangeTrustOperationForm({ onAdd, publicKey }) {
  const [assetCode, setAssetCode] = useState('');
  const [issuer, setIssuer] = useState('');
  const [limit, setLimit] = useState('922337203685.4775807');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!assetCode || assetCode.length === 0 || assetCode.length > 12) {
      setError('Asset code required (1-12 characters)');
      return;
    }

    if (!issuer) {
      setError('Issuer account required');
      return;
    }

    if (limit && (isNaN(limit) || parseFloat(limit) < 0)) {
      setError('Valid limit required (0 to remove trustline)');
      return;
    }

    onAdd({
      asset: {
        code: assetCode,
        issuer,
      },
      limit: limit || '0',
    });

    setAssetCode('');
    setIssuer('');
    setLimit('922337203685.4775807');
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <p role="alert" style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 8 }}>
          {error}
        </p>
      )}

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="trust-asset-code" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          Asset Code
        </label>
        <input
          id="trust-asset-code"
          type="text"
          value={assetCode}
          onChange={(e) => setAssetCode(e.target.value.toUpperCase())}
          placeholder="USDC"
          maxLength="12"
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="trust-issuer" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          Issuer Account
        </label>
        <input
          id="trust-issuer"
          type="text"
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          placeholder="G..."
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="trust-limit" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          Limit (XLM)
        </label>
        <input
          id="trust-limit"
          type="number"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder="922337203685.4775807"
          step="0.0000001"
          min="0"
          style={{ width: '100%' }}
        />
        <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
          Set to 0 to remove trustline
        </p>
      </div>

      <button type="submit" style={{ width: '100%', marginTop: 8 }}>
        Add Trustline Operation
      </button>
    </form>
  );
}
