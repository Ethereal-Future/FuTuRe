import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';
import { StatusMessage } from './StatusMessage.jsx';

/**
 * Display asset balance with trustline limits and ability to modify limits
 */
export function AssetBalanceWithTrustline({ accountId, onSuccess }) {
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [modifyingAsset, setModifyingAsset] = useState(null);
  const [newLimit, setNewLimit] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchAssets = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await apiClient.get(`/api/stellar/trustline/balances/${accountId}`);
      setAssets(data.balances || []);
    } catch (err) {
      setError('Failed to fetch asset balances');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accountId) fetchAssets();
  }, [accountId]);

  const getUtilizationPercentage = (balance, limit) => {
    if (limit === null || limit === 0) return 0;
    return Math.min(100, (balance / limit) * 100);
  };

  const isNearCapacity = (balance, limit) => {
    return limit !== null && getUtilizationPercentage(balance, limit) >= 90;
  };

  const formatBalance = (balance, limit, assetCode) => {
    if (assetCode === 'XLM') {
      return `${parseFloat(balance).toFixed(2)} XLM`;
    }

    if (limit === null) {
      return `${parseFloat(balance).toFixed(7)} ${assetCode}`;
    }

    return `${parseFloat(balance).toFixed(7)} / ${parseFloat(limit).toFixed(7)} ${assetCode}`;
  };

  const handleModifyLimit = async (assetCode, asset) => {
    if (!newLimit || isNaN(newLimit)) {
      setError('Please enter a valid limit');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    try {
      const { data } = await apiClient.post('/api/stellar/trustline/modify-limit', {
        sourceSecret: '', // In production, this would come from the secure context
        assetCode,
        issuer: asset.issuer,
        newLimit: parseFloat(newLimit),
      });

      setSuccess(`Trustline limit for ${assetCode} updated to ${newLimit}`);
      setModifyingAsset(null);
      setNewLimit('');
      await fetchAssets();
      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err.normalized?.message || 'Failed to modify trustline limit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div>Loading asset balances...</div>;
  }

  return (
    <section className="section" aria-labelledby="assets-heading">
      <h2 id="assets-heading">Asset Balances & Trustlines</h2>

      {error && <StatusMessage type="error" message={error} />}
      {success && <StatusMessage type="success" message={success} />}

      {assets.length === 0 ? (
        <p style={{ color: '#888' }}>No assets with trustlines.</p>
      ) : (
        <div
          role="list"
          style={{
            display: 'grid',
            gap: 12,
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          }}
        >
          {assets.map((asset) => {
            const utilization = getUtilizationPercentage(asset.balance, asset.limit);
            const isNear = isNearCapacity(asset.balance, asset.limit);

            return (
              <div
                key={asset.assetCode}
                role="listitem"
                style={{
                  padding: 12,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  backgroundColor: isNear ? '#fef3c7' : '#ffffff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px 0', fontSize: '1rem' }}>{asset.assetCode}</h3>
                    {asset.issuer && (
                      <p style={{ margin: 0, fontSize: '0.75rem', color: '#666' }}>
                        Issuer: {asset.issuer.substring(0, 10)}...
                      </p>
                    )}
                  </div>
                  {asset.assetCode !== 'XLM' && (
                    <button
                      type="button"
                      onClick={() => {
                        setModifyingAsset(asset.assetCode);
                        setNewLimit(asset.limit?.toString() || '');
                      }}
                      style={{
                        padding: '6px 12px',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                      }}
                    >
                      Edit Limit
                    </button>
                  )}
                </div>

                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: '0 0 6px 0', fontSize: '0.9rem' }}>
                    Balance: <strong>{formatBalance(asset.balance, asset.limit, asset.assetCode)}</strong>
                  </p>

                  {asset.assetCode !== 'XLM' && asset.limit !== null && (
                    <>
                      <div
                        style={{
                          width: '100%',
                          height: 8,
                          backgroundColor: '#e5e7eb',
                          borderRadius: 4,
                          overflow: 'hidden',
                          marginBottom: 6,
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.min(100, utilization)}%`,
                            backgroundColor: isNear ? '#ea580c' : '#10b981',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                      <p style={{ margin: 0, fontSize: '0.85rem', color: '#666' }}>
                        Utilization: {utilization.toFixed(1)}%
                      </p>

                      {isNear && (
                        <p style={{ margin: '6px 0 0 0', fontSize: '0.85rem', color: '#ea580c' }}>
                          ⚠️ Trustline near capacity (≥90%)
                        </p>
                      )}
                    </>
                  )}
                </div>

                {modifyingAsset === asset.assetCode && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e5e7eb' }}>
                    <label htmlFor={`limit-${asset.assetCode}`} style={{ fontSize: '0.9rem' }}>
                      New Limit:
                    </label>
                    <input
                      id={`limit-${asset.assetCode}`}
                      type="number"
                      value={newLimit}
                      onChange={(e) => setNewLimit(e.target.value)}
                      placeholder="0.00"
                      step="0.0000001"
                      min="0"
                      max="922337203685.4775807"
                      style={{
                        width: '100%',
                        padding: 8,
                        marginTop: 6,
                        marginBottom: 8,
                        borderRadius: 4,
                        border: '1px solid #d1d5db',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => handleModifyLimit(asset.assetCode, asset)}
                        disabled={submitting}
                        style={{ flex: 1, padding: 8 }}
                      >
                        {submitting ? 'Updating...' : 'Update'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setModifyingAsset(null);
                          setNewLimit('');
                        }}
                        disabled={submitting}
                        style={{
                          flex: 1,
                          padding: 8,
                          backgroundColor: '#f3f4f6',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
