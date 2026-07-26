import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';
import { useMessages } from '../hooks/useMessages';

export function BumpSequenceOperation({ publicKey }) {
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
      setError('Please enter a valid sequence number');
      return;
    }

    const targetNum = BigInt(targetSequence);
    const currentNum = BigInt(currentSequence);

    if (targetNum <= currentNum) {
      setError(`Target sequence must be greater than current sequence (${currentSequence})`);
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
      msg.success(`Sequence bumped to ${response.data.newSequence}`);
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
        ⚠️ Bump Sequence Number
      </h4>
      <p style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#64748b' }}>
        Use this to resolve stuck transactions due to sequence number mismatches. Only experienced users should use this feature.
      </p>

      {error && (
        <div style={{ padding: 8, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 4, marginBottom: 12, color: '#991b1b', fontSize: '0.9rem' }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ padding: 8, background: '#dcfce7', border: '1px solid #86efac', borderRadius: 4, marginBottom: 12, color: '#166534', fontSize: '0.9rem' }}>
          ✓ Sequence number bumped successfully
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem', fontWeight: 500 }}>
          Current Sequence
        </label>
        <input
          type="text"
          value={currentSequence ?? 'Loading…'}
          disabled
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4, background: '#f3f4f6' }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4, fontSize: '0.9rem', fontWeight: 500 }}>
          Target Sequence
        </label>
        <input
          type="number"
          value={targetSequence}
          onChange={(e) => setTargetSequence(e.target.value)}
          min={currentSequence ? String(BigInt(currentSequence) + 1n) : '0'}
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 4 }}
          placeholder="Enter target sequence number"
        />
        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.8rem' }}>
          Must be greater than {currentSequence ?? '(loading)'}
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
        {loading ? 'Processing…' : 'Bump Sequence'}
      </button>
    </div>
  );
}
