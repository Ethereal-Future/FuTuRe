import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import apiClient from '../api/client.js';
import { useMessages } from '../hooks/useMessages';

export function BumpSequenceOperation({ publicKey }) {
  const { t } = useTranslation();
  const [currentSequence, setCurrentSequence] = useState(null);
  const [targetSequence, setTargetSequence] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const msg = useMessages();

  useEffect(() => {
    fetchCurrentSequence();
  }, [publicKey]);

  const fetchCurrentSequence = async () => {
    try {
      const { data } = await apiClient.get(`/api/stellar/account/${publicKey}`);
      setCurrentSequence(data.sequence);
      setTargetSequence(String(BigInt(data.sequence) + 1n));
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    }
  };

  const handleBumpSequence = async () => {
    setError(null);
    setSuccess(false);

    if (!targetSequence || isNaN(targetSequence)) {
      setError(t('bumpSequence.invalidTarget'));
      return;
    }

    const targetNum = BigInt(targetSequence);
    const currentNum = BigInt(currentSequence);

    if (targetNum <= currentNum) {
      setError(t('bumpSequence.mustBeGreater', { current: currentSequence }));
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post('/api/stellar/account/bump-sequence', {
        sourceSecret: localStorage.getItem('secretKey'),
        bumpToSequence: targetSequence,
      });

      setSuccess(true);
      setCurrentSequence(response.data.newSequence);
      setTargetSequence(String(BigInt(response.data.newSequence) + 1n));
      msg.success(t('bumpSequence.bumpedTo', { sequence: response.data.newSequence }));
    } catch (e) {
      const errorMsg = e?.response?.data?.error ?? e.message;
      setError(errorMsg);
      msg.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 12, background: '#fef2f2', borderRadius: 6, border: '1px solid #fecaca' }}>
      <h4 style={{ margin: '0 0 12px 0', color: '#991b1b' }}>
        {t('bumpSequence.title')}
      </h4>
      <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#64748b' }}>
        {t('bumpSequence.description')}
      </p>

      {error && (
        <div style={{ padding: 8, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, marginBottom: 12, color: '#991b1b', fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: 8, background: '#dcfce7', border: '1px solid #86efac', borderRadius: 4, marginBottom: 12, color: '#166534', fontSize: '0.9rem' }}>
          {t('bumpSequence.success')}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem', fontWeight: 500 }}>
          {t('bumpSequence.currentSequence')}
        </label>
        <input
          type="text"
          value={currentSequence ?? t('bumpSequence.loading')}
          disabled
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: '#f3f4f6' }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem', fontWeight: 500 }}>
          {t('bumpSequence.targetSequence')}
        </label>
        <input
          type="number"
          value={targetSequence}
          onChange={(e) => setTargetSequence(e.target.value)}
          min={currentSequence ? String(BigInt(currentSequence) + 1n) : '0'}
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4 }}
          placeholder={t('bumpSequence.targetPlaceholder')}
        />
        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
          {t('bumpSequence.mustBeGreaterThan', { current: currentSequence ?? '(loading)' })}
        </p>
      </div>

      <button
        type="button"
        onClick={handleBumpSequence}
        disabled={loading || currentSequence === null}
        style={{
          padding: '8px 16px',
          background: loading ? '#d1d5db' : '#dc2626',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          cursor: loading ? 'not-allowed' : 'pointer',
          fontWeight: 500,
        }}
      >
        {loading ? t('bumpSequence.processing') : t('bumpSequence.submit')}
      </button>
    </div>
  );
}
