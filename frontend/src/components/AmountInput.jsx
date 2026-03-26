import { useState } from 'react';

const CURRENCIES = { XLM: 'Stellar Lumens', USDC: 'USD Coin', BTC: 'Bitcoin' };

/**
 * AmountInput — numeric input with currency selector and live formatting.
 * Props: value, onChange, currency, onCurrencyChange, availableBalance
 */
export function AmountInput({ value, onChange, currency = 'XLM', onCurrencyChange, availableBalance }) {
  const [focused, setFocused] = useState(false);

  const handleChange = (e) => {
    // Allow only valid decimal numbers
    const raw = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    onChange?.(raw);
  };

  const setMax = () => {
    if (availableBalance != null) onChange?.(String(availableBalance));
  };

  const formatted = !focused && value
    ? Number(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 7 })
    : value;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ position: 'relative', flex: 1 }}>
        <input
          type="text"
          inputMode="decimal"
          value={formatted}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="0.0000000"
          style={{ paddingRight: availableBalance != null ? 52 : 10 }}
          aria-label="Amount"
        />
        {availableBalance != null && (
          <button
            type="button"
            onClick={setMax}
            style={maxBtnStyle}
            title={`Max: ${availableBalance}`}
          >
            MAX
          </button>
        )}
      </div>
      <select
        value={currency}
        onChange={e => onCurrencyChange?.(e.target.value)}
        style={selectStyle}
        aria-label="Currency"
      >
        {Object.entries(CURRENCIES).map(([code, name]) => (
          <option key={code} value={code} title={name}>{code}</option>
        ))}
      </select>
    </div>
  );
}

const maxBtnStyle = {
  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
  background: 'none', color: '#0066cc', border: 'none', padding: '2px 4px',
  fontSize: 11, fontWeight: 700, cursor: 'pointer', width: 'auto', minHeight: 'unset', minWidth: 'unset',
};
const selectStyle = {
  border: '1px solid #ddd', borderRadius: 4, padding: '10px 8px',
  fontSize: 14, background: 'white', cursor: 'pointer', minHeight: 44,
};
