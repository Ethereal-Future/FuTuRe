# services/streaming.js: Stream payment failures do not recalculate next execution time, causing rapid back-to-back failure retries on identical ticks

**Domain:** Payment Streaming  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `resilience`  
**Issue ID:** ISSUE-122

---

## Background
In `backend/src/services/streaming.js`:
```javascript
const secondsSinceLast = (now - lastProcessed) / 1000;
if (secondsSinceLast >= stream.intervalSeconds) {
  try {
    const result = await sendPayment(...);
    // On success: updates lastProcessedAt = now
  } catch (err) {
    // On failure: does NOT update lastProcessedAt!
    await prisma.paymentStream.update({
      data: { failureCount: { increment: 1 } }
    });
  }
}
```

## Problem
- When `sendPayment` fails (e.g. Horizon transient error or insufficient balance):
  - `lastProcessedAt` is NEVER updated.
  - On the next worker tick 10 seconds later, `secondsSinceLast` is STILL `>= stream.intervalSeconds`!
  - The worker immediately attempts to process the exact same failing stream again on the next tick, and again on the following tick!
  - 3 consecutive ticks take only 30 seconds, causing the stream to immediately burn through all retry attempts and transition to `FAILED`!

## Proposed Solution
On payment failure, update `nextAttemptAt` or set `lastProcessedAt = now` with a temporary backoff delay:
```javascript
const backoffSeconds = Math.min(stream.intervalSeconds, 60 * Math.pow(2, updatedStream.failureCount));
await prisma.paymentStream.update({
  where: { id: stream.id },
  data: {
    failureCount: { increment: 1 },
    nextAttemptAt: new Date(Date.now() + backoffSeconds * 1000),
  }
});
```
In `processActiveStreams`, query `where: { nextAttemptAt: { lte: now } }`.

## Implementation Steps
1. Add `nextAttemptAt: DateTime?` column to `PaymentStream` in Prisma schema.
2. Update failure handler in `streaming.js` to compute exponential backoff and set `nextAttemptAt`.
3. Filter streams in `processActiveStreams` by `OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]`.
4. Add unit tests verifying failure backoff delay prevents immediate re-execution on next tick.

## Acceptance Criteria
- [ ] Failed streams back off exponentially before re-attempting.
- [ ] Streams do not burn through retry allowances in back-to-back 10-second ticks.
- [ ] Transient Horizon errors have time to resolve before retry exhaustion.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1369](https://github.com/Ethereal-Future/FuTuRe/issues/1369)
