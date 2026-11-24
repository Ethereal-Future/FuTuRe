/**
 * Exact stroop (1 XLM = 10^7 stroops) arithmetic using BigInt (#1701).
 *
 * Surge-pricing fee spikes can exceed Number.MAX_SAFE_INTEGER, where float
 * math silently loses precision or yields NaN. Everything here stays in
 * BigInt and only converts to a display string at the very end.
 */

export const STROOPS_PER_XLM = 10_000_000n;
const XLM_DECIMALS = 7;

/**
 * Parse a stroop value (bigint | integer number | digit string) to BigInt.
 * Returns null for anything that isn't a finite, non-negative integer.
 */
export function toStroops(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    // Unsafe integers lose precision; refuse rather than mis-display.
    if (!Number.isSafeInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!/^\d+$/.test(s)) return null;
    return BigInt(s);
  }
  return null;
}

/**
 * Parse a decimal XLM amount string (e.g. "12.3456789") to stroops exactly.
 * Extra fractional digits beyond 7 are truncated. Returns null if invalid.
 */
export function xlmToStroops(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return null;
  const whole = BigInt(m[1] || '0');
  const frac = BigInt(((m[2] || '') + '0'.repeat(XLM_DECIMALS)).slice(0, XLM_DECIMALS));
  return whole * STROOPS_PER_XLM + frac;
}

/**
 * Format stroops as a locale-aware XLM amount string without ever going
 * through a float. The integer part uses Intl grouping (BigInt-capable);
 * the fractional part is trimmed of trailing zeros.
 */
export function formatStroopsAsXlm(stroops, { locale, minimumFractionDigits = 0 } = {}) {
  const v = toStroops(stroops);
  if (v === null) return '—';
  const whole = v / STROOPS_PER_XLM;
  let frac = (v % STROOPS_PER_XLM).toString().padStart(XLM_DECIMALS, '0').replace(/0+$/, '');
  if (frac.length < minimumFractionDigits) frac = frac.padEnd(minimumFractionDigits, '0');

  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const intStr = nf.format(whole);
  if (!frac) return intStr;
  const decimal =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.';
  return `${intStr}${decimal}${frac}`;
}
