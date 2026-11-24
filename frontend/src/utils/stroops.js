/**
 * Precise stroop arithmetic for Stellar amounts (#1701).
 *
 * 1 XLM = 10,000,000 stroops. During network surge pricing, fee values can
 * grow large enough that floating-point math loses precision or produces
 * NaN / exponent strings ("1e+21"). All computation here is done on BigInt
 * stroops and formatted with Intl.NumberFormat, never with float math.
 */

export const STROOPS_PER_XLM = 10_000_000n;
const DECIMALS = 7;

/**
 * Expand a numeric string in exponent notation ("1.5e+21") to a plain
 * decimal string ("1500000000000000000000"). Returns null if malformed.
 */
function expandExponent(str) {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?e([+-]?\d+)$/i.exec(str);
  if (!m) return null;
  const [, sign, intPart = '', fracPart = '', expStr] = m;
  if (!intPart && !fracPart) return null;
  const exp = parseInt(expStr, 10);
  // Position of the decimal point within `digits` after shifting by `exp`.
  // Leading zeros are harmless: BigInt() and the decimal regex accept them.
  const digits = intPart + fracPart;
  const point = intPart.length + exp;
  let out;
  if (point <= 0) out = `0.${'0'.repeat(-point)}${digits}`;
  else if (point >= digits.length) out = digits + '0'.repeat(point - digits.length);
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return sign + out;
}

/**
 * Convert an XLM amount (string, number or bigint of whole XLM) to BigInt
 * stroops. Fractional digits beyond 7 are truncated. Returns null when the
 * input cannot be interpreted as a finite decimal number.
 * @param {string|number|bigint|null|undefined} value
 * @returns {bigint|null}
 */
export function xlmToStroops(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'bigint') return value * STROOPS_PER_XLM;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;

  let str = String(value).trim();
  if (/e/i.test(str)) {
    str = expandExponent(str);
    if (str === null) return null;
  }
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(str);
  if (!m || (!m[2] && !m[3])) return null;
  const [, sign, intPart, fracPart = ''] = m;
  const stroops =
    BigInt(intPart || '0') * STROOPS_PER_XLM +
    BigInt((fracPart + '0'.repeat(DECIMALS)).slice(0, DECIMALS));
  return sign === '-' ? -stroops : stroops;
}

/**
 * Parse an integer stroop value (as returned by Horizon `/fee_stats`) into a
 * BigInt. Returns null for anything that is not a finite integer.
 * @param {string|number|bigint|null|undefined} value
 * @returns {bigint|null}
 */
export function parseStroops(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)) : null;
  }
  const str = String(value).trim();
  if (/^[+-]?\d+$/.test(str)) return BigInt(str);
  if (/e/i.test(str)) {
    const expanded = expandExponent(str);
    if (expanded && /^[+-]?\d+$/.test(expanded)) return BigInt(expanded);
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
 * Format BigInt stroops as an XLM amount using the locale's grouping and
 * decimal separators. Trailing fractional zeros are trimmed.
 * @param {bigint} stroops
 * @param {string} [locale]
 * @returns {string}
 */
export function formatStroopsAsXLM(stroops, locale) {
  if (typeof stroops !== 'bigint') return '—';
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / STROOPS_PER_XLM;
  const frac = (abs % STROOPS_PER_XLM).toString().padStart(DECIMALS, '0').replace(/0+$/, '');

  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  // Intl.NumberFormat#format accepts BigInt, so grouping is exact at any size.
  const wholeStr = nf.format(whole);
  const decimalSep =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((p) => p.type === 'decimal')?.value ?? '.';

  return `${negative ? '-' : ''}${wholeStr}${frac ? decimalSep + frac : ''}`;
}

/**
 * Convert BigInt stroops to a JS number of XLM for *display-only* fiat
 * conversions. Returns null if the result is not finite.
 * @param {bigint} stroops
 * @returns {number|null}
 */
export function stroopsToXLMNumber(stroops) {
  if (typeof stroops !== 'bigint') return null;
  const whole = Number(stroops / STROOPS_PER_XLM);
  const frac = Number(stroops % STROOPS_PER_XLM) / 1e7;
  const n = whole + frac;
  return Number.isFinite(n) ? n : null;
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
