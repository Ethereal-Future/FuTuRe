const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const SURGE_THRESHOLD = 5;

let feeSamples = [];

/**
 * Record an observed network fee sample for rolling surge detection.
 * Samples older than seven days are pruned on every call.
 * @param {number} feeStroops - Observed fee in stroops
 * @returns {void}
 */
export function recordFeeSample(feeStroops) {
  const now = Date.now();
  feeSamples.push({ fee: feeStroops, timestamp: now });
  const cutoff = now - SEVEN_DAYS_MS;
  feeSamples = feeSamples.filter((s) => s.timestamp > cutoff);
}

/**
 * Compute the average fee across all samples recorded in the last seven days.
 * @returns {number|null} Average fee in stroops, or null if no samples are in range
 */
export function getSevenDayAverageFee() {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const samples = feeSamples.filter((s) => s.timestamp > cutoff);
  if (samples.length === 0) return null;
  return samples.reduce((sum, s) => sum + s.fee, 0) / samples.length;
}

/**
 * Determine whether a current fee represents a surge relative to the recent average.
 * @param {number} currentFee - Fee to evaluate, in stroops
 * @param {number|null} averageFee - Baseline average fee (e.g. from getSevenDayAverageFee)
 * @param {number} [threshold=SURGE_THRESHOLD] - Ratio above which a surge is flagged
 * @returns {{surge: boolean, ratio: number, threshold: number}} Whether a surge was detected, the fee ratio, and the threshold used
 */
export function detectFeeSurge(currentFee, averageFee, threshold = SURGE_THRESHOLD) {
  if (!averageFee || averageFee <= 0) {
    return { surge: false, ratio: 1, threshold };
  }
  const ratio = currentFee / averageFee;
  return {
    surge: ratio > threshold,
    ratio: Math.round(ratio * 100) / 100,
    threshold,
  };
}

/**
 * Clear all recorded fee samples.
 * @returns {void}
 */
export function resetFeeHistory() {
  feeSamples = [];
}

/**
 * Replace the recorded fee samples wholesale (e.g. to seed state for tests or from persisted history).
 * @param {Array<{fee: number, timestamp: number}>} samples - Samples to install
 * @returns {void}
 */
export function setFeeHistory(samples) {
  feeSamples = [...samples];
}
