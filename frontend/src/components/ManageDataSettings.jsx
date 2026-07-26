import { useState, useEffect } from 'react';
import apiClient from '../api/client.js';

export function ManageDataSettings({ publicKey, onClose, onUpdate }) {
  const [dataEntries, setDataEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [dataKey, setDataKey] = useState('');
  const [dataValue, setDataValue] = useState('');
  const [deleteMode, setDeleteMode] = useState(false);
  const [editingKey, setEditingKey] = useState('');

  useEffect(() => {
    loadDataEntries();
  }, [publicKey]);

  const loadDataEntries = async () => {
    try {
      setLoading(true);
      setError('');

      const { data } = await apiClient.get(`/api/stellar/account/${publicKey}`);

      const entries = Object.entries(data.data || {}).map(([key, value]) => ({
        key,
        value: decodeDataValue(value),
        rawValue: value,
      }));

      setDataEntries(entries);
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setLoading(false);
    }
  };

  const decodeDataValue = (encodedValue) => {
    try {
      // Try UTF-8 decoding
      const binaryString = atob(encodedValue);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const decoder = new TextDecoder('utf-8', { fatal: true });
      return decoder.decode(bytes);
    } catch {
      // Return hex representation if not valid UTF-8
      return `[HEX] ${encodedValue}`;
    }
  };

  const validateInput = () => {
    if (!dataKey || dataKey.length === 0 || dataKey.length > 64) {
      setError('Key required and must be 1-64 bytes');
      return false;
    }

    if (!deleteMode && (!dataValue || dataValue.length > 64)) {
      setError('Value required and must be 1-64 bytes');
      return false;
    }

    return true;
  };

  const handleAddOrUpdate = async (e) => {
    e.preventDefault();
    setError('');

    if (!validateInput()) {
      return;
    }

    setSaving(true);

    try {
      const payload = {
        sourceSecret: localStorage.getItem('secretKey'),
        key: dataKey,
        value: deleteMode ? null : dataValue,
      };

      await apiClient.post(`/api/stellar/account/${publicKey}/manage-data`, payload);

      setDataKey('');
      setDataValue('');
      setDeleteMode(false);
      setEditingKey('');
      setShowForm(false);

      await loadDataEntries();
      onUpdate?.();
    } catch (e) {
      setError(e?.response?.data?.error ?? e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEditEntry = (entry) => {
    setDataKey(entry.key);
    setDataValue(entry.value.startsWith('[HEX]') ? '' : entry.value);
    setDeleteMode(false);
    setEditingKey(entry.key);
    setShowForm(true);
  };

  const handleDeleteEntry = (entry) => {
    setDataKey(entry.key);
    setDataValue('');
    setDeleteMode(true);
    setEditingKey(entry.key);
    setShowForm(true);
  };

  const handleCancel = () => {
    setDataKey('');
    setDataValue('');
    setDeleteMode(false);
    setEditingKey('');
    setShowForm(false);
    setError('');
  };

  if (loading) {
    return <p>Loading data entries…</p>;
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
        <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>Manage Data</h3>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            style={{ fontSize: '0.8rem', padding: '4px 8px' }}
          >
            + Add Entry
          </button>
        )}
      </div>

      {error && (
        <p role="alert" style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: 8 }}>
          {error}
        </p>
      )}

      {showForm && (
        <form
          onSubmit={handleAddOrUpdate}
          style={{
            background: '#f8fafc',
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
          }}
        >
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
              disabled={editingKey !== '' && deleteMode}
              style={{ width: '100%' }}
            />
            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
              Current: {dataKey.length}/64 bytes
            </p>
          </div>

          <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              id="delete-entry"
              type="checkbox"
              checked={deleteMode}
              onChange={(e) => setDeleteMode(e.target.checked)}
              style={{ width: 'auto', minHeight: 'unset' }}
            />
            <label htmlFor="delete-entry" style={{ fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>
              Delete this entry
            </label>
          </div>

          {!deleteMode && (
            <div style={{ marginBottom: 8 }}>
              <label htmlFor="data-value" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
                Value (max 64 bytes, UTF-8)
              </label>
              <textarea
                id="data-value"
                value={dataValue}
                onChange={(e) => setDataValue(e.target.value)}
                placeholder="Enter data value"
                maxLength="64"
                rows="3"
                style={{ width: '100%' }}
              />
              <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                Current: {dataValue.length}/64 bytes
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              disabled={saving}
              style={{ flex: 1, background: '#22c55e' }}
            >
              {saving ? 'Saving…' : deleteMode ? 'Delete Entry' : 'Save Entry'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="btn-clear"
              style={{ flex: 1 }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div>
        {dataEntries.length === 0 ? (
          <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
            No data entries on this account.
          </p>
        ) : (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {dataEntries.map((entry) => (
              <li
                key={entry.key}
                style={{
                  background: '#f8fafc',
                  borderRadius: 6,
                  padding: 12,
                  border: '1px solid #e2e8f0',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem', fontFamily: 'monospace' }}>
                      {entry.key}
                    </p>
                    <p
                      style={{
                        margin: '4px 0 0',
                        fontSize: '0.85rem',
                        color: '#64748b',
                        wordBreak: 'break-all',
                        fontFamily: entry.value.startsWith('[HEX]') ? 'monospace' : 'inherit',
                      }}
                    >
                      {entry.value.substring(0, 100)}
                      {entry.value.length > 100 ? '…' : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 4, marginLeft: 12 }}>
                    <button
                      type="button"
                      onClick={() => handleEditEntry(entry)}
                      style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteEntry(entry)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.8rem',
                        background: '#ef4444',
                        color: '#fff',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
