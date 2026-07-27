import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function ManageDataOperationForm({ onAdd }) {
  const { t } = useTranslation();
  const [dataKey, setDataKey] = useState('');
  const [dataValue, setDataValue] = useState('');
  const [deleteMode, setDeleteMode] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!dataKey || dataKey.length === 0 || dataKey.length > 64) {
      setError(t('manageDataForm.keyRequired'));
      return;
    }

    if (!deleteMode && (!dataValue || dataValue.length > 64)) {
      setError(t('manageDataForm.valueRequired'));
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
          {t('manageDataForm.keyLabel')}
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
          {t('manageDataForm.currentBytes', { count: dataKey.length })}
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
          {t('manageDataForm.deleteEntry')}
        </label>
      </div>

      {!deleteMode && (
        <div style={{ marginBottom: 8 }}>
          <label htmlFor="data-value" style={{ display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>
            {t('manageDataForm.valueLabel')}
          </label>
          <textarea
            id="data-value"
            value={dataValue}
            onChange={(e) => setDataValue(e.target.value)}
            placeholder={t('manageDataForm.valuePlaceholder')}
            maxLength="64"
            rows="3"
            style={{ width: '100%' }}
          />
          <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#64748b' }}>
            {t('manageDataForm.currentBytes', { count: dataValue.length })}
          </p>
        </div>
      )}

      <button type="submit" style={{ width: '100%', marginTop: 8 }}>
        {t('manageDataForm.submit')}
      </button>
    </form>
  );
}
