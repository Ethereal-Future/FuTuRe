/** Default slippage tolerance (percent) applied to AMM deposit price bounds. */
export const DEFAULT_PRICE_TOLERANCE_PCT = 1;
/** Ratio movement (percent) that invalidates an open deposit quote. */
export const QUOTE_STALE_THRESHOLD_PCT = 0.5;

/**
 * Compute liquidityPoolDeposit `minPrice` / `maxPrice` (price = amountA / amountB)
 * widened by `tolerancePct` percent. Mirrors backend services/pool.js.
 * @returns {{price: number, minPrice: string, maxPrice: string} | null}
 */
export function computeDepositPriceBounds(amountA, amountB, tolerancePct = DEFAULT_PRICE_TOLERANCE_PCT) {
  const a = parseFloat(amountA);
  const b = parseFloat(amountB);
  if (!(a > 0) || !(b > 0)) return null;
  const parsedTol = parseFloat(tolerancePct);
  const tol = Number.isFinite(parsedTol) && parsedTol >= 0 ? parsedTol : DEFAULT_PRICE_TOLERANCE_PCT;
  const price = a / b;
  return {
    price,
    minPrice: (price * (1 - tol / 100)).toFixed(7),
    maxPrice: (price * (1 + tol / 100)).toFixed(7),
  };
}

/** Pool ratio expressed as reserveB per reserveA. */
export function poolRatio(pool) {
  if (!pool || !(pool.reserveA > 0)) return null;
  return pool.reserveB / pool.reserveA;
}

/** Absolute percent change from `from` to `to`. */
export function ratioChangePct(from, to) {
  if (!(from > 0) || !(to > 0)) return 0;
  return Math.abs((to - from) / from) * 100;
}
