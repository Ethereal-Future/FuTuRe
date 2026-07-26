import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';

export function ThresholdSettings({ publicKey, onClose, onUpdate }) {
  const [thresholds, setThresholds] = useState(null);
  const [signers, setSigners] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [lowThreshold, setLowThreshold] = useState('');
  const [medThreshold, setMedThreshold] = useState('');
  const [highThreshold, setHighThreshold] = useState('');

  useEffect(() => {
    loadThresholds();
  }, [publicKey]);

  const loadThresholds = async () => {
    try {
      setLoading(true);
      setError('');

      const { data } = await apiClient.get(`/api/stellar/account/${publicKey}`);

      setThresholds({
        lowThreshold: data.thresholds?.low_threshold || 0,
        medThreshold: data.thresholds?.med_threshold || 0,
        highThreshold: data.thresholds?.high_threshold || 0,
      });

      setLowThreshold(data.thresholds?.low_threshold?.toString() || '0');
      setMedThreshold(data.thresholds?.med_threshold?.toString() || '0');
      setHighThreshold(data.thresholds?.high_threshold?.toString() || '0');

      setSigners(data.signers || []);
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setLoading(false);
    }
  };

  const calculateMaxSignerWeight = () => {
    return signers.reduce((sum, signer) => sum + (signer.weight || 0), 0);
  };

  const validateThresholds = () => {
    const low = parseInt(lowThreshold, 10);
    const med = parseInt(medThreshold, 10);
    const high = parseInt(highThreshold, 10);
    const maxWeight = calculateMaxSignerWeight();

    // Validate ranges
    if (low < 0 || low > 255 || med < 0 || med > 255 || high < 0 || high > 255) {
      setError('All thresholds must be between 0 and 255');
      return false;
    }

    // Validate ordering
    if (med > high) {
      setError('Medium threshold cannot be greater than high threshold');
      return false;
    }

    // Check if high threshold is achievable
    if (high > maxWeight) {
      setError(`High threshold (${high}) cannot exceed total signer weight (${maxWeight})`);
      return false;
    }

    return true;
  };

  const handleSave = async () => {
    if (!validateThresholds()) {
      return;
    }

    if (!confirm('⚠️ WARNING: Changing thresholds can lock your account if configured incorrectly. Are you sure?')) {
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        sourceSecret: localStorage.getItem('secretKey'),
        lowThreshold: parseInt(lowThreshold, 10),
        medThreshold: parseInt(medThreshold, 10),
        highThreshold: parseInt(highThreshold, 10),
      };

      await apiClient.post(`/api/stellar/account/${publicKey}/set-thresholds`, payload);

      setThresholds({
        lowThreshold: parseInt(lowThreshold, 10),
        medThreshold: parseInt(medThreshold, 10),
        highThreshold: parseInt(highThreshold, 10),
      });

      setEditMode(false);
      onUpdate?.();
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setSaving(false);
    }
  };

  const THRESHOLD_DESCRIPTIONS = {
    low: 'Low threshold: Required for operations like AllowTrust',
    med: 'Medium threshold: Required for most operations like Payment',
    high: 'High threshold: Required for critical operations like SetOptions (changing thresholds/signers)',
  };

  if (loading) {
    return <p>Loading thresholds…</p>;
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>Signing Thresholds</h3>
        {!editMode && (
          <button
            type="button"
            onClick={() => setEditMode(true)}
            style={{ fontSize: '0.8rem', padding: '4px 8px' }}
          >
            Edit
          </button>
        )}
      </div>

      {error && (
        <p role="alert" style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 8 }}>
          {error}
        </p>
      )}

      {!editMode && thresholds && (
        <div
          style={{
            background: '#f8fafc',
            borderRadius: 6,
            padding: 12,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Low Threshold</p>
            <p style={{ margin: '4px 0 0', fontSize: '1.25rem', fontWeight: 600 }}>
              {thresholds.lowThreshold}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
              {THRESHOLD_DESCRIPTIONS.low}
            </p>
          </div>

          <div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Medium Threshold</p>
            <p style={{ margin: '4px 0 0', fontSize: '1.25rem', fontWeight: 600 }}>
              {thresholds.medThreshold}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
              {THRESHOLD_DESCRIPTIONS.med}
            </p>
          </div>

          <div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>High Threshold</p>
            <p style={{ margin: '4px 0 0', fontSize: '1.25rem', fontWeight: 600 }}>
              {thresholds.highThreshold}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
              {THRESHOLD_DESCRIPTIONS.high}
            </p>
          </div>
        </div>
      )}

      {editMode && (
        <div
          style={{
            background: '#f8fafc',
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <p style={{ margin: '0 0 12px', fontSize: '0.85rem', color: '#64748b' }}>
            Total signer weight available: {calculateMaxSignerWeight()}
          </p>

          <div style={{ marginBottom: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div>
              <label htmlFor="low-threshold" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
                Low (0-255)
              </label>
              <input
                id="low-threshold"
                type="number"
                value={lowThreshold}
                onChange={(e) => setLowThreshold(e.target.value)}
                min="0"
                max="255"
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label htmlFor="med-threshold" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
                Medium (0-255)
              </label>
              <input
                id="med-threshold"
                type="number"
                value={medThreshold}
                onChange={(e) => setMedThreshold(e.target.value)}
                min="0"
                max="255"
                style={{ width: '100%' }}
              />
            </div>

            <div>
              <label htmlFor="high-threshold" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
                High (0-255)
              </label>
              <input
                id="high-threshold"
                type="number"
                value={highThreshold}
                onChange={(e) => setHighThreshold(e.target.value)}
                min="0"
                max="255"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{ flex: 1, background: '#22c55e' }}
            >
              {saving ? 'Saving…' : 'Save Thresholds'}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditMode(false);
                setError('');
                loadThresholds();
              }}
              className="btn-clear"
              style={{ flex: 1 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e2e8f0' }}>
        <p style={{ margin: '0 0 8px', fontSize: '0.85rem', fontWeight: 600 }}>Current Signers</p>
        {signers.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>No additional signers</p>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {signers.map((signer) => (
              <li
                key={signer.public_key}
                style={{
                  padding: '6px 0',
                  fontSize: '0.8rem',
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ color: '#64748b', fontFamily: 'monospace' }}>
                  {signer.public_key.substring(0, 10)}…
                </span>
                <span style={{ fontWeight: 600 }}>Weight: {signer.weight}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
