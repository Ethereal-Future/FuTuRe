const MAX_DECIMALS = 7;

function resolveLocale(locale?: string): string {
  if (locale) return locale;
  if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
  return 'en-US';
}

export function formatBalance(
  value: string | number | null | undefined,
  decimals: number = MAX_DECIMALS,
  locale?: string,
): string {
  if (value === null || value === undefined || value === '') return '—';
  const num = parseFloat(String(value));
  if (isNaN(num)) return String(value);

  // Very small non-zero: show in fixed notation with max precision
  if (num > 0 && num < 0.0000001) return '< 0.0000001';

  return new Intl.NumberFormat(resolveLocale(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(num);
}

export function formatBalanceWithAsset(
  balance: string | number | null | undefined,
  asset?: string,
  locale?: string,
): string {
  const formatted = formatBalance(balance, MAX_DECIMALS, locale);
  return asset ? `${formatted} ${asset}` : formatted;
}
