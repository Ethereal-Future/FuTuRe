import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import apiClient from '../api/client.js';
import { useMessages } from '../hooks/useMessages';
import { CopyButton } from './CopyButton';
import { FeeDisplay } from './FeeDisplay';

const ITEMS_PER_PAGE = 10;

export function ClaimableBalances({ publicKey }) {
  const { t } = useTranslation();
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [claimingId, setClaimingId] = useState(null);
  const [page, setPage] = useState(1);
  const msg = useMessages();

  useEffect(() => {
    fetchClaimableBalances();
  }, [publicKey]);

  const fetchClaimableBalances = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get(
        `/api/stellar/claimable-balances?claimant=${publicKey}`
      );
      setBalances(Array.isArray(data) ? data : data.balances || []);
      setPage(1);
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
      setBalances([]);
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async (balanceId) => {
    setClaimingId(balanceId);
    try {
      await apiClient.post('/api/stellar/claimable-balance/claim', {
        sourceSecret: localStorage.getItem('secretKey'),
        balanceId,
      });
      msg.success(t('claimableBalances.claimedSuccess'));
      await fetchClaimableBalances();
    } catch (e) {
      const errorMsg = e?.response?.data?.error ?? e.message;
      msg.error(errorMsg);
    } finally {
      setClaimingId(null);
    }
  };

  const isExpired = (balance) => {
    if (!balance.clawback_claimants_v0) return false;
    const claimant = balance.clawback_claimants_v0.find(c => c.destination === publicKey);
    if (!claimant || !claimant.predicate) return false;
    if (claimant.predicate.unconditional) return false;
    if (claimant.predicate.predicate_type === 'predicate_before_absolute_time') {
      return new Date(parseInt(claimant.predicate.timestamp) * 1000) < new Date();
    }
    return false;
  };

  const paginatedBalances = balances.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
  const totalPages = Math.ceil(balances.length / ITEMS_PER_PAGE);

  return (
    <div style={{ marginBottom: 20, padding: 16, background: '#f9fafb', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>{t('claimableBalances.title')}</h3>
        <button
          type="button"
          onClick={fetchClaimableBalances}
          disabled={loading}
          style={{
            padding: '6px 12px',
            background: loading ? '#d1d5db' : '#0066cc',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: 12,
          }}
        >
          {loading ? t('claimableBalances.loading') : '🔄 Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, marginBottom: 12, color: '#991b1b', fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {balances.length === 0 && !loading && !error && (
        <p style={{ color: '#666', fontSize: 14, margin: 0 }}>{t('claimableBalances.empty')}</p>
      )}

      {paginatedBalances.length > 0 && (
        <div>
          {paginatedBalances.map((balance) => {
            const expired = isExpired(balance);
            return (
              <div
                key={balance.id}
                style={{
                  padding: 12,
                  marginBottom: 8,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  background: expired ? '#fef2f2' : '#fff',
                  opacity: expired ? 0.7 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      {balance.amount} {balance.asset_code || 'native'}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: 4 }}>
                      {t('claimableBalances.from')} <code style={{ background: '#f0f0f0', padding: '2px 4px', borderRadius: 2 }}>{balance.sponsor?.slice(0, 20)}…</code>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#666' }}>
                      {t('claimableBalances.id')} <code style={{ background: '#f0f0f0', padding: '2px 4px', borderRadius: 2 }}>{balance.id?.slice(0, 20)}…</code>
                      <CopyButton text={balance.id} />
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {expired && (
                      <span style={{ background: '#fca5a5', color: '#991b1b', padding: '4px 8px', borderRadius: 4, fontSize: '0.8rem', fontWeight: 600 }}>
                        {t('claimableBalances.expired')}
                      </span>
                    )}
                    {!expired && (
                      <button
                        type="button"
                        onClick={() => handleClaim(balance.id)}
                        disabled={claimingId === balance.id}
                        style={{
                          padding: '8px 16px',
                          background: claimingId === balance.id ? '#d1d5db' : '#10b981',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 4,
                          cursor: claimingId === balance.id ? 'not-allowed' : 'pointer',
                          fontSize: '0.9rem',
                        }}
                      >
                        {claimingId === balance.id ? t('claimableBalances.claiming') : t('claimableBalances.claim')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{ padding: '6px 12px', background: page === 1 ? '#d1d5db' : '#0066cc', color: '#fff', border: 'none', borderRadius: 4, cursor: page === 1 ? 'not-allowed' : 'pointer' }}
              >
                ← {t('common.previous')}
              </button>
              <span style={{ alignSelf: 'center', fontSize: '0.9rem' }}>
                {t('common.pageOf', { page, total: totalPages })}
              </span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={{ padding: '6px 12px', background: page === totalPages ? '#d1d5db' : '#0066cc', color: '#fff', border: 'none', borderRadius: 4, cursor: page === totalPages ? 'not-allowed' : 'pointer' }}
              >
                {t('common.next')} →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
