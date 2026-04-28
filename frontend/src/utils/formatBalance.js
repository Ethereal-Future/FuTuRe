const MAX_DECIMALS = 7;

/**
 * Format a Stellar balance value for display.
 * - Adds thousand separators
 * - Limits to 7 decimal places (Stellar precision)
 * - Handles very small and very large numbers
 */
export function formatBalance(value, decimals = MAX_DECIMALS) {
  if (value === null || value === undefined || value === '') return '—';
  const num = parseFloat(value);
  if (isNaN(num)) return String(value);

  // Very small non-zero: show in fixed notation with max precision
  if (num > 0 && num < 0.0000001) return '< 0.0000001';

  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a balance with its asset label, e.g. "1,234.5670000 XLM"
 */
export function formatBalanceWithAsset(balance, asset) {
  const formatted = formatBalance(balance);
  return asset ? `${formatted} ${asset}` : formatted;
}
