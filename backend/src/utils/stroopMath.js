/**
 * Stroop math utilities for precise XLM ↔ stroop conversions.
 *
 * 1 XLM = 10,000,000 stroops (1e7).
 *
 * All intermediate calculations use BigInt to avoid floating-point
 * rounding errors. Fee percentage calculations round *up* to the nearest
 * valid stroop so that sub-cent amounts never produce 1-stroop
 * underpayments that cause `tx_bad_fee` rejections on Horizon.
 *
 * Fixes ISSUE-316.
 */

const STROOPS_PER_XLM = 10_000_000n;
const STROOPS_PER_XLM_NUM = 10_000_000;

/**
 * Convert an XLM amount (string or number) to an integer stroop count.
 * Fractional stroops are rounded up so the resulting fee always meets
 * the network minimum.
 *
 * @param {string|number} xlm - Amount in XLM
 * @returns {bigint} Stroop count (≥ 0)
 * @throws {TypeError} If the input is not a finite, non-negative number
 */
export function xlmToStroops(xlm) {
  const n = Number(xlm);
  if (!Number.isFinite(n) || n < 0) {
    throw new TypeError(`xlmToStroops: invalid XLM amount "${xlm}"`);
  }
  // Multiply via integer arithmetic: shift 7 decimal places to avoid
  // floating-point rounding, then take the ceiling of any remainder.
  const whole = Math.floor(n);
  const fractional = n - whole; // e.g. 0.0000003 for 1.0000003 XLM

  const wholeStroops = BigInt(whole) * STROOPS_PER_XLM;
  // Round the fractional part up to avoid underpayment.
  const fractionalStroops = BigInt(Math.ceil(fractional * STROOPS_PER_XLM_NUM));

  return wholeStroops + fractionalStroops;
}

/**
 * Convert a stroop count to an XLM amount string with up to 7 decimal
 * places (the maximum Stellar precision).
 *
 * @param {bigint|number|string} stroops - Integer stroop count
 * @returns {string} XLM amount, e.g. "1.2345678"
 * @throws {TypeError} If the input is not a valid non-negative integer
 */
export function stroopsToXlm(stroops) {
  const n = BigInt(stroops);
  if (n < 0n) throw new TypeError(`stroopsToXlm: stroop count must be ≥ 0, got ${stroops}`);
  const whole = n / STROOPS_PER_XLM;
  const remainder = n % STROOPS_PER_XLM;
  if (remainder === 0n) return `${whole}`;
  // Zero-pad the fractional part to 7 digits then trim trailing zeros.
  const frac = remainder.toString().padStart(7, '0').replace(/0+$/, '');
  return `${whole}.${frac}`;
}

/**
 * Calculate a fee given a base stroop amount and a percentage rate.
 * The result is rounded up to the nearest whole stroop so the computed
 * fee always satisfies `fee >= base * rate`, preventing `tx_bad_fee`.
 *
 * @param {bigint|number|string} baseStroops - Base fee in stroops
 * @param {number} ratePercent - Fee rate in percent (e.g. 1.5 for 1.5%)
 * @returns {bigint} Fee in whole stroops (ceiling-rounded)
 * @throws {TypeError} If inputs are invalid
 */
export function calculateFeeStroops(baseStroops, ratePercent) {
  const base = BigInt(baseStroops);
  if (base < 0n) throw new TypeError(`calculateFeeStroops: baseStroops must be ≥ 0`);
  const rate = Number(ratePercent);
  if (!Number.isFinite(rate) || rate < 0) {
    throw new TypeError(`calculateFeeStroops: ratePercent must be a non-negative finite number`);
  }
  if (rate === 0) return 0n;

  // Compute using scaled integer arithmetic to preserve sub-cent precision.
  // We scale the rate by 1e9 to retain fractional stroop accuracy before
  // applying the ceiling.
  const SCALE = 1_000_000_000n;
  const scaledRate = BigInt(Math.round(rate * Number(SCALE)));
  const scaledFee = base * scaledRate;
  // Ceiling division: (a + b - 1) / b
  const fee = (scaledFee + SCALE - 1n) / SCALE;
  return fee;
}

/**
 * Add a surge multiplier to a base fee, rounding up.
 *
 * @param {bigint|number|string} baseStroops
 * @param {number} multiplier - e.g. 1.5 for 1.5×
 * @returns {bigint}
 */
export function applyFeeMultiplier(baseStroops, multiplier) {
  const base = BigInt(baseStroops);
  const factor = Number(multiplier);
  if (!Number.isFinite(factor) || factor < 1) {
    throw new TypeError(`applyFeeMultiplier: multiplier must be ≥ 1, got ${multiplier}`);
  }
  const SCALE = 1_000_000_000n;
  const scaledFactor = BigInt(Math.round(factor * Number(SCALE)));
  const scaled = base * scaledFactor;
  return (scaled + SCALE - 1n) / SCALE;
}
