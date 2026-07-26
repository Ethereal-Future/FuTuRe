import { useState } from 'react';

export function ManageDataOperationForm({ onAdd }) {
  const [dataKey, setDataKey] = useState('');
  const [dataValue, setDataValue] = useState('');
  const [deleteMode, setDeleteMode] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!dataKey || dataKey.length === 0 || dataKey.length > 64) {
      setError('Key required (1-64 bytes)');
      return;
    }

    if (!deleteMode && (!dataValue || dataValue.length > 64)) {
      setError('Value required and must be 1-64 bytes');
      return;
    }

    onAdd({
      key: dataKey,
      value: deleteMode ? null : dataValue,
    });

    setDataKey('');
    setDataValue('');
    setDeleteMode(false);
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <p role="alert" style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 8 }}>
          {error}
        </p>
      )}

      <div style={{ marginBottom: 8 }}>
        <label htmlFor="data-key" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
          Key (max 64 bytes)
        </label>
        <input
          id="data-key"
          type="text"
          value={dataKey}
          onChange={(e) => setDataKey(e.target.value)}
          placeholder="kyc_status"
          maxLength="64"
          style={{ width: '100%' }}
        />
        <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
          Current: {dataKey.length}/64 bytes
        </p>
      </div>

      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <input
          id="delete-mode"
          type="checkbox"
          checked={deleteMode}
          onChange={(e) => setDeleteMode(e.target.checked)}
          style={{ width: 'auto', minHeight: 'unset' }}
        />
        <label htmlFor="delete-mode" style={{ fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>
          Delete this entry
        </label>
      </div>

      {!deleteMode && (
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="data-value" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
            Value (max 64 bytes)
          </label>
          <textarea
            id="data-value"
            value={dataValue}
            onChange={(e) => setDataValue(e.target.value)}
            placeholder="Enter data value (UTF-8 text)"
            maxLength="64"
            rows="3"
            style={{ width: '100%' }}
          />
          <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            Current: {dataValue.length}/64 bytes
          </p>
        </div>
      )}

      <button type="submit" style={{ width: '100%', marginTop: 8 }}>
        Add Data Operation
      </button>
    </form>
  );
}
