import { useState } from 'react';
import apiClient from '../api/client.js';
import { useMessages } from '../hooks/useMessages';
import { FeeDisplay } from './FeeDisplay';

export function CreateClaimableBalance({ onSuccess }) {
  const [formData, setFormData] = useState({
    asset: 'native',
    assetCode: '',
    amount: '',
    claimant: '',
    expiryTime: '',
    minClaimTime: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [txResult, setTxResult] = useState(null);
  const msg = useMessages();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
      ...(name === 'asset' && value !== 'custom' && { assetCode: '' }),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setTxResult(null);

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    if (!formData.claimant || formData.claimant.length < 40) {
      setError('Please enter a valid claimant account address');
      return;
    }

    if (formData.asset === 'custom' && !formData.assetCode) {
      setError('Please enter an asset code');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        sourceSecret: localStorage.getItem('secretKey'),
        asset: formData.asset === 'native' ? 'native' : formData.assetCode || formData.asset,
        amount: formData.amount,
        claimant: formData.claimant,
        expiryTime: formData.expiryTime ? Math.floor(new Date(formData.expiryTime).getTime() / 1000) : undefined,
        minClaimTime: formData.minClaimTime ? Math.floor(new Date(formData.minClaimTime).getTime() / 1000) : undefined,
      };

      const response = await apiClient.post('/api/stellar/claimable-balance/create', payload);
      setTxResult(response.data);
      msg.success('Claimable balance created successfully!');

      setFormData({
        asset: 'native',
        assetCode: '',
        amount: '',
        claimant: '',
        expiryTime: '',
        minClaimTime: '',
      });

      if (onSuccess) {
        onSuccess(response.data);
      }
    } catch (e) {
      const errorMsg = e?.response?.data?.error ?? e.message;
      setError(errorMsg);
      msg.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginBottom: 20, padding: 16, background: '#f0f9ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
      <h3 style={{ margin: '0 0 16px 0' }}>📦 Create Claimable Balance</h3>

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, marginBottom: 12, color: '#991b1b', fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {txResult && (
        <div style={{ padding: 12, background: '#dcfce7', border: '1px solid #86efac', borderRadius: 4, marginBottom: 12, color: '#166534', fontSize: '0.9rem' }}>
          <strong>Success!</strong> Claimable Balance ID: <code style={{ background: '#fff', padding: '2px 4px', borderRadius: 2 }}>{txResult.balanceId}</code>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Asset
          </label>
          <select
            name="asset"
            value={formData.asset}
            onChange={handleChange}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4 }}
          >
            <option value="native">XLM (Native)</option>
            <option value="USDC">USDC</option>
            <option value="EURC">EURC</option>
            <option value="custom">Other Asset</option>
          </select>
        </div>

        {formData.asset === 'custom' && (
          <div>
            <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
              Asset Code
            </label>
            <input
              type="text"
              name="assetCode"
              value={formData.assetCode}
              onChange={handleChange}
              placeholder="e.g., USD"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4 }}
            />
          </div>
        )}

        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Amount
          </label>
          <input
            type="number"
            name="amount"
            value={formData.amount}
            onChange={handleChange}
            placeholder="0.00"
            step="0.0001"
            min="0"
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4 }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Claimant Account
          </label>
          <input
            type="text"
            name="claimant"
            value={formData.claimant}
            onChange={handleChange}
            placeholder="GXXXXXXXXXX..."
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.9rem' }}
          />
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
            Public key of the account that can claim this balance
          </p>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Expiry Date (Optional)
          </label>
          <input
            type="datetime-local"
            name="expiryTime"
            value={formData.expiryTime}
            onChange={handleChange}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4 }}
          />
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
            Balance cannot be claimed after this time
          </p>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
            Earliest Claim Date (Optional)
          </label>
          <input
            type="datetime-local"
            name="minClaimTime"
            value={formData.minClaimTime}
            onChange={handleChange}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4 }}
          />
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
            Balance cannot be claimed before this time
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '10px 16px',
            background: loading ? '#d1d5db' : '#0066cc',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 500,
          }}
        >
          {loading ? 'Creating…' : 'Create Claimable Balance'}
        </button>
      </form>

      <FeeDisplay />
    </div>
  );
}
