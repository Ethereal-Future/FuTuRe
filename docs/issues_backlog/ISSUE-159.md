# security/threatDetector.js: Sliding window memory leak from uncleaned IP request maps

**Domain:** Security & Memory  
**Complexity:** Medium  
**Labels:** `bug`, `memory-leak`, `security`  
**Issue ID:** ISSUE-159

---

## Background
In `backend/src/security/threatDetector.js`:
The threat detector maintains in-memory tracking maps:
```javascript
this.requestTracker = new Map(); // ip -> [timestamps]
this.anomalyScores = new Map();  // ip -> score
```
Client requests are pushed into `requestTracker` to detect rate anomalies and potential DDoS attacks.

## Problem
- While timestamps older than the evaluation window may be filtered during an active check, IP entries with no recent traffic are never deleted from `this.requestTracker` or `this.anomalyScores`.
- In production with public Internet exposure, millions of distinct IP addresses touch the server over weeks.
- The `Map` retains millions of empty or stale array entries, consuming hundreds of megabytes of heap memory until the Node.js process crashes with `JavaScript heap out of memory`.

## Proposed Solution
1. Implement periodic sweep / TTL eviction for `requestTracker` and `anomalyScores`.
2. Delete IP keys when their timestamp arrays become empty:
```javascript
if (recentTimestamps.length === 0) {
  this.requestTracker.delete(ip);
}
```
3. Or delegate request rate tracking to Redis with automatic TTL per IP key.

## Implementation Steps
1. Clean up empty entries in `recordRequest` within `backend/src/security/threatDetector.js`.
2. Add periodic cleanup timer (e.g. every 10 minutes) with `.unref()` to prune inactive IPs.
3. Add unit test verifying map size returns to zero after window expires.

## Acceptance Criteria
- [ ] Inactive IPs are evicted from memory tracking structures.
- [ ] Memory footprint remains bounded under continuous unique IP traffic.
- [ ] Unit tests confirm no residual keys remain after window expiration.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Prevents gradual degradation and heap exhaustion in security workers.

**GitHub Issue:** [1406](https://github.com/Ethereal-Future/FuTuRe/issues/1406)
