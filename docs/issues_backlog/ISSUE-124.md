# services/streaming.js: Payment stream interval execution drifts over time due to scheduling based on completion time rather than fixed intervals

**Domain:** Payment Streaming  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `resilience`  
**Issue ID:** ISSUE-124

---

## Background
In `backend/src/services/streaming.js`:
```javascript
if (result.success) {
  await prisma.paymentStream.update({
    where: { id: stream.id },
    data: {
      lastProcessedAt: now, // sets lastProcessedAt to completion time
      totalStreamed: { increment: stream.rateAmount },
    },
  });
```

## Problem
- `lastProcessedAt` is updated to `now` (the time the payment transaction completed on Horizon).
- For a stream configured with `intervalSeconds = 60` (1 minute):
  - Tick 1 runs at 12:00:00. Payment completes at 12:00:04. `lastProcessedAt = 12:00:04`.
  - Next interval checks `now - 12:00:04 >= 60`. Tick runs at 12:01:10. Payment completes at 12:01:15. `lastProcessedAt = 12:01:15`.
- Every cycle adds 4-15 seconds of execution latency to the schedule. Over 24 hours (1,440 intervals), the schedule drifts by multiple hours, resulting in fewer payments sent than intended!

## Proposed Solution
Schedule based on scheduled time rather than completion time:
```javascript
const scheduledTime = new Date(new Date(stream.lastProcessedAt).getTime() + stream.intervalSeconds * 1000);
// Or compute expected interval slots:
await prisma.paymentStream.update({
  where: { id: stream.id },
  data: {
    lastProcessedAt: scheduledTime > now ? scheduledTime : now,
    totalStreamed: { increment: stream.rateAmount },
  }
});
```
This preserves schedule cadence without compounding transaction execution latency.

## Implementation Steps
1. Refactor `lastProcessedAt` advancement logic in `services/streaming.js`.
2. Advance timestamp by exact `intervalSeconds * 1000` increments.
3. Handle catching up if worker was offline for multiple intervals.
4. Add unit tests verifying zero cumulative schedule drift over 50 simulated intervals.

## Acceptance Criteria
- [ ] Payment stream schedule does not drift over time.
- [ ] Total payments delivered in a 24-hour window match `86400 / intervalSeconds`.
- [ ] Execution latency does not delay subsequent payment intervals.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1371](https://github.com/Ethereal-Future/FuTuRe/issues/1371)
