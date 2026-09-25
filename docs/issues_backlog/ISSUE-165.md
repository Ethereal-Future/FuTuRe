# loadTesting/capacityPlanner.js: Division by zero and NaN propagation when `avgResponseTime` or `currentThroughput` is zero

**Domain:** Load Testing & Diagnostics  
**Complexity:** Medium  
**Labels:** `bug`, `loadtest`, `math`  
**Issue ID:** ISSUE-165

---

## Background
In `backend/src/loadTesting/capacityPlanner.js` (lines 14-23):
```javascript
    const responseTimeHeadroom = 5000 / avgResponseTime;
    const maxCapacity = Math.min(maxSafeThroughput, currentThroughput * responseTimeHeadroom);

    return {
      currentThroughput: Math.round(currentThroughput),
      maxSafeThroughput: Math.round(maxSafeThroughput),
      maxCapacity: Math.round(maxCapacity),
      headroom: Math.round((maxCapacity / currentThroughput - 1) * 100),
      recommendations: this.getRecommendations(maxCapacity, currentThroughput)
    };
```
When capacity planning calculations are run against baseline tests with zero traffic, fast mocks (0ms response time), or failed runs.

## Problem
- If `avgResponseTime` is `0` (e.g. mocked responses, sub-millisecond local tests):
  `5000 / avgResponseTime` evaluates to `Infinity`.
- If `currentThroughput` is `0` (e.g. test run failed or no requests succeeded):
  `maxCapacity / currentThroughput` evaluates to `0 / 0` = `NaN`.
- `Math.round(NaN)` returns `NaN`.
- Downstream reporting dashboards and automated capacity checks crash when serializing or formatting `NaN` and `Infinity`.

## Proposed Solution
1. Validate inputs and guard against non-positive numbers:
```javascript
if (!currentThroughput || currentThroughput <= 0) {
  return { currentThroughput: 0, maxSafeThroughput: 0, maxCapacity: 0, headroom: 0, recommendations: [] };
}
const safeAvgResponseTime = Math.max(avgResponseTime || 1, 1);
const responseTimeHeadroom = 5000 / safeAvgResponseTime;
```
2. Clamp headroom calculations and ensure all returned metrics are valid finite numbers.

## Implementation Steps
1. Add defensive checks in `calculateCapacity` in `backend/src/loadTesting/capacityPlanner.js`.
2. Add unit tests for edge cases: `avgResponseTime = 0`, `currentThroughput = 0`, and negative inputs.
3. Verify output objects contain only finite integers.

## Acceptance Criteria
- [ ] `calculateCapacity` never returns `NaN` or `Infinity`.
- [ ] Gracefully handles zero-traffic and zero-latency inputs.
- [ ] All unit test edge cases pass.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Prevents crashes in automated capacity reporting pipelines.

**GitHub Issue:** [1412](https://github.com/Ethereal-Future/FuTuRe/issues/1412)
