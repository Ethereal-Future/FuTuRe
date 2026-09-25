# loadTesting/throughput.js: Precision loss and lack of windowed rate tracking in throughput calculation

**Domain:** Load Testing & Metrics  
**Complexity:** Medium  
**Labels:** `enhancement`, `loadtest`, `metrics`  
**Issue ID:** ISSUE-170

---

## Background
In `backend/src/loadTesting/throughput.js` (lines 8-11):
```javascript
export function throughputRps(totalRequests, durationMs) {
  if (!totalRequests || !durationMs || durationMs <= 0) return 0;
  return totalRequests / (durationMs / 1000);
}
```
Throughput is calculated purely as a single global average over the entire test duration.

## Problem
- Calculating only a single global average hides critical performance degradation curves:
  - Cold start warmup delays.
  - Periodic GC pauses and cache expiry storms.
  - Throughput collapse during server resource exhaustion.
- A test that processed 1,000 req/s for 10 seconds and 0 req/s for 10 seconds shows 500 req/s average, masking total service failure!

## Proposed Solution
1. Implement a windowed / rolling throughput calculator (e.g. 1-second sliding buckets).
2. Calculate peak throughput, sustained throughput, and 1-second percentile distributions.
3. Export time-series throughput arrays for visualization in load test graphs.

## Implementation Steps
1. Implement `RollingThroughputTracker` class in `backend/src/loadTesting/throughput.js`.
2. Track requests per second in 1-second resolution buckets.
3. Provide methods for `getPeakRps()`, `getSustainedRps()`, and `getTimeline()`.

## Acceptance Criteria
- [ ] Supports both instantaneous rolling throughput and total run averages.
- [ ] Captures throughput drops during GC or database latency spikes.
- [ ] Unit tests verify accurate bucketed calculations.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Enables granular throughput trend analysis.

**GitHub Issue:** [1417](https://github.com/Ethereal-Future/FuTuRe/issues/1417)
