# services/streaming.js: Sequential stream payment execution blocks worker tick and delays subsequent stream schedules

**Domain:** Payment Streaming  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `performance`, `backend`  
**Issue ID:** ISSUE-121

---

## Background
In `backend/src/services/streaming.js`, `processActiveStreams` iterates over all eligible streams using a sequential `for` loop (lines 284-360):
```javascript
for (const stream of activeStreams) {
  if (secondsSinceLast >= stream.intervalSeconds) {
    const result = await sendPayment(...); // Each takes 1-5 seconds on Horizon!
    await prisma.paymentStream.update(...);
  }
}
```

## Problem
- `sendPayment` makes multiple network requests (loading account, building transaction, submitting to Horizon, invalidating cache). Each payment takes 2 to 5 seconds.
- If there are 30 active payment streams due:
  - 30 streams * 3 seconds = **90 seconds** of sequential execution.
- A 90-second execution time completely overflows the 10-30 second worker tick interval.
- Streams scheduled for 60-second intervals drift significantly, executing every 3-5 minutes instead of every 60 seconds!

## Proposed Solution
Execute stream payments with controlled concurrency using `p-limit`:
```javascript
const limit = pLimit(5); // Process up to 5 streams concurrently
await Promise.allSettled(dueStreams.map(stream => limit(() => processSingleStream(stream))));
```
5 concurrent payments reduce a 90-second run down to ~18 seconds, well within the scheduling window.

## Implementation Steps
1. Extract single-stream processing logic into `processSingleStream(stream)` helper.
2. Use `p-limit` with concurrency of 5 in `processActiveStreams`.
3. Add metrics tracking `streaming_worker_duration_seconds` and `active_streams_processed_total`.
4. Add tests verifying parallel execution of multiple due streams.

## Acceptance Criteria
- [ ] Active streams are processed in parallel with bounded concurrency.
- [ ] Worker tick execution finishes within the scheduled tick window.
- [ ] Streaming schedule drift is minimized.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1368](https://github.com/Ethereal-Future/FuTuRe/issues/1368)
