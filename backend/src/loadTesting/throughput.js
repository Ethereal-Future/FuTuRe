/**
 * Compute request throughput in requests per second (req/s).
 *
 * @param {number} totalRequests
 * @param {number} durationMs elapsed wall time in milliseconds
 * @returns {number} throughput in req/s, or 0 when duration is non-positive
 */
export function throughputRps(totalRequests, durationMs) {
  if (!totalRequests || !durationMs || durationMs <= 0) return 0;
  return totalRequests / (durationMs / 1000);
}
