import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatAssetAmount, normalizeAmountInput } from '../utils/formatAmount';

const CURRENCIES = { XLM: 'Stellar Lumens', USDC: 'USD Coin', BTC: 'Bitcoin' };

/**
 * AmountInput — numeric input with currency selector and live formatting.
 * Props: value, onChange, currency, onCurrencyChange, availableBalance
 */
export function AmountInput({ value, onChange, currency = 'XLM', onCurrencyChange, availableBalance }) {
  const { i18n } = useTranslation();
  const [focused, setFocused] = useState(false);

  const handleChange = (e) => {
    // Accept the locale's decimal separator (e.g. ',' in fr-FR) and
    // normalise it to '.' so the stored/submitted value is unambiguous.
    onChange?.(normalizeAmountInput(e.target.value, i18n.language));
  };

  const setMax = () => {
    if (availableBalance != null) onChange?.(String(availableBalance));
  };

  // While not focused, display the amount using the active locale's
  // grouping and decimal separators. The underlying `value` stored via
  // onChange always uses '.' as the decimal separator, so it stays
  // unambiguous for blockchain APIs regardless of display locale.
  const formatted = !focused && value
    ? formatAssetAmount(value, { maximumFractionDigits: 7, locale: i18n.language })
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
            aria-label={`Send maximum available amount: ${availableBalance}`}
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
