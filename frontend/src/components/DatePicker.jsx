/**
 * DatePicker — date range picker for transaction filtering.
 * Props: from, to, onChange({ from, to })
 */
export function DatePicker({ from, to, onChange }) {
  const today = new Date().toISOString().split('T')[0];

  const set = (key, val) => onChange?.({ from, to, [key]: val });

  const clear = () => onChange?.({ from: '', to: '' });

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={labelStyle}>From</label>
        <input
          type="date"
          value={from || ''}
          max={to || today}
          onChange={e => set('from', e.target.value)}
          style={inputStyle}
          aria-label="From date"
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={labelStyle}>To</label>
        <input
          type="date"
          value={to || ''}
          min={from || undefined}
          max={today}
          onChange={e => set('to', e.target.value)}
          style={inputStyle}
          aria-label="To date"
        />
      </div>
      {(from || to) && (
        <button
          type="button"
          onClick={clear}
          style={{ alignSelf: 'flex-end', background: 'none', color: '#888', border: '1px solid #ddd', borderRadius: 4, padding: '8px 10px', fontSize: 12, cursor: 'pointer', width: 'auto', minHeight: 'unset', minWidth: 'unset' }}
          aria-label="Clear dates"
        >
          Clear
        </button>
      )}
    </div>
  );
}

const labelStyle = { fontSize: 12, color: '#555', fontWeight: 600 };
const inputStyle = { border: '1px solid #ddd', borderRadius: 4, padding: '8px 10px', fontSize: 14, minHeight: 44 };
