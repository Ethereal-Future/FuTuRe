import { useTranslation } from 'react-i18next';

/**
 * DatePicker — date range picker for transaction filtering.
 * Props: from, to, onChange({ from, to })
 */
export function DatePicker({ from, to, onChange }) {
  const { t } = useTranslation();
  const today = new Date().toISOString().split('T')[0];

  const set = (key, val) => onChange?.({ from, to, [key]: val });

  const clear = () => onChange?.({ from: '', to: '' });

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={labelStyle}>{t('datePicker.from')}</label>
        <input
          type="date"
          value={from || ''}
          max={to || today}
          onChange={e => set('from', e.target.value)}
          style={inputStyle}
          aria-label={t('datePicker.fromDate')}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={labelStyle}>{t('datePicker.to')}</label>
        <input
          type="date"
          value={to || ''}
          min={from || undefined}
          max={today}
          onChange={e => set('to', e.target.value)}
          style={inputStyle}
          aria-label={t('datePicker.toDate')}
        />
      </div>
      {(from || to) && (
        <button
          type="button"
          onClick={clear}
          style={{ alignSelf: 'flex-end', background: 'none', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 10px', fontSize: 12, cursor: 'pointer', width: 'auto', minHeight: 'unset', minWidth: 'unset' }}
          aria-label={t('datePicker.clearDates')}
        >
          {t('datePicker.clear')}
        </button>
      )}
    </div>
  );
}

const labelStyle = { fontSize: 12, color: 'var(--muted)', fontWeight: 600 };
const inputStyle = { border: '1px solid var(--border)', borderRadius: 4, padding: '8px 10px', fontSize: 14, minHeight: 44, background: 'var(--surface)', color: 'var(--text)' };
