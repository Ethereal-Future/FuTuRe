const MAX_DECIMALS = 7;

export function formatBalance(value: string | number | null | undefined, decimals: number = MAX_DECIMALS): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = parseFloat(String(value));
  if (isNaN(num)) return String(value);

  // Very small non-zero: show in fixed notation with max precision
  if (num > 0 && num < 0.0000001) return '< 0.0000001';

  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function formatBalanceWithAsset(balance: string | number | null | undefined, asset?: string): string {
  const formatted = formatBalance(balance);
  return asset ? `${formatted} ${asset}` : formatted;
}
