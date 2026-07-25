const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const SURGE_THRESHOLD = 5;

let feeSamples = [];

export function recordFeeSample(feeStroops) {
  const now = Date.now();
  feeSamples.push({ fee: feeStroops, timestamp: now });
  const cutoff = now - SEVEN_DAYS_MS;
  feeSamples = feeSamples.filter((s) => s.timestamp > cutoff);
}

export function getSevenDayAverageFee() {
  const cutoff = Date.now() - SEVEN_DAYS_MS;
  const samples = feeSamples.filter((s) => s.timestamp > cutoff);
  if (samples.length === 0) return null;
  return samples.reduce((sum, s) => sum + s.fee, 0) / samples.length;
}

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

export function resetFeeHistory() {
  feeSamples = [];
}

export function setFeeHistory(samples) {
  feeSamples = [...samples];
}
