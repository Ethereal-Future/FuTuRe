import { createRedisBackend } from '../cache/redis.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const REDIS_KEY = 'fee:samples';
export const SURGE_THRESHOLD = 5;

// In-memory window (time-ordered) backed by a Redis sorted set so history
// survives restarts. Redis is optional; without it we fall back to memory only.
let feeSamples = [];
let redis = null;
if (process.env.NODE_ENV !== 'test') {
  try {
    const backend = createRedisBackend();
    if (backend.isConfigured()) redis = backend.client;
  } catch { /* Redis unavailable — memory only */ }
}

/** Drop samples older than the cutoff. Samples are time-ordered, so only the head is scanned. */
function pruneExpired(cutoff) {
  let i = 0;
  while (i < feeSamples.length && feeSamples[i].timestamp <= cutoff) i++;
  if (i > 0) feeSamples.splice(0, i);
}

/**
 * Load persisted fee samples from Redis into memory.
 * @returns {Promise<void>}
 */
export async function hydrateFeeHistory() {
  if (!redis) return;
  try {
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    await redis.zremrangebyscore(REDIS_KEY, '-inf', cutoff);
    const raw = await redis.zrangebyscore(REDIS_KEY, cutoff, '+inf', 'WITHSCORES');
    const loaded = [];
    for (let i = 0; i < raw.length; i += 2) {
      loaded.push({ fee: Number(raw[i].split(':')[0]), timestamp: Number(raw[i + 1]) });
    }
    const merged = [...loaded, ...feeSamples].sort((a, b) => a.timestamp - b.timestamp);
    feeSamples = merged;
  } catch { /* fall back to in-memory only */ }
}

function persistSample(feeStroops, now) {
  if (!redis) return;
  const cutoff = now - SEVEN_DAYS_MS;
  redis
    .multi()
    .zadd(REDIS_KEY, now, `${feeStroops}:${now}:${Math.random().toString(36).slice(2, 8)}`)
    .zremrangebyscore(REDIS_KEY, '-inf', cutoff)
    .pexpire(REDIS_KEY, SEVEN_DAYS_MS)
    .exec()
    .catch(() => {});
}

hydrateFeeHistory();

/**
 * Record an observed network fee sample for rolling surge detection.
 * Samples older than seven days are pruned on every call.
 * @param {number} feeStroops - Observed fee in stroops
 * @returns {void}
 */
export function recordFeeSample(feeStroops) {
  const now = Date.now();
  feeSamples.push({ fee: feeStroops, timestamp: now });
  pruneExpired(now - SEVEN_DAYS_MS);
  persistSample(feeStroops, now);
}

/**
 * Compute the average fee across all samples recorded in the last seven days.
 * @returns {number|null} Average fee in stroops, or null if no samples are in range
 */
export function getSevenDayAverageFee() {
  pruneExpired(Date.now() - SEVEN_DAYS_MS);
  if (feeSamples.length === 0) return null;
  let sum = 0;
  for (const s of feeSamples) sum += s.fee;
  return sum / feeSamples.length;
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
  redis?.del(REDIS_KEY).catch(() => {});
}

/**
 * Replace the recorded fee samples wholesale (e.g. to seed state for tests or from persisted history).
 * @param {Array<{fee: number, timestamp: number}>} samples - Samples to install
 * @returns {void}
 */
export function setFeeHistory(samples) {
  feeSamples = [...samples].sort((a, b) => a.timestamp - b.timestamp);
}
