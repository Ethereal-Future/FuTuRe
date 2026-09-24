# services/streaming.js: Stream cancellation does not execute a final prorated partial payment for elapsed seconds in the current active interval

**Domain:** Payment Streaming  
**Complexity:** Medium  
**Labels:** `enhancement`, `stellar`, `defi`  
**Issue ID:** ISSUE-128

---

## Background
In `backend/src/services/streaming.js`, `cancelStream` sets `status = 'CANCELLED'` immediately (lines 156-170):
```javascript
export async function cancelStream(id) {
  const stream = await prisma.paymentStream.update({
    where: { id },
    data: { status: 'CANCELLED' },
    include: { sender: true },
  });
```

## Problem
- For streams with long intervals (e.g. daily intervals where $100 is sent every 24 hours):
  - If the sender cancels the stream at hour 23 (23 hours after the last payment):
  - The recipient receives $0 for the 23 hours of services rendered or work performed!
  - The elapsed time is completely discarded without any final prorated settlement.
- This creates unfair economic loss for service providers and contractors streaming salaries or services.

## Proposed Solution
Add an optional `settleProrated: Boolean` parameter to `cancelStream`:
1. Calculate elapsed seconds since `lastProcessedAt`: `elapsed = (now - lastProcessedAt) / 1000`.
2. Compute prorated amount: `proratedAmount = (stream.rateAmount * elapsed) / stream.intervalSeconds`.
3. If `settleProrated && proratedAmount >= 0.0000001`, execute a final one-off payment of `proratedAmount` before setting status to `CANCELLED`.
4. Record the final settlement payment in `totalStreamed` and stream history.

## Implementation Steps
1. Add `settleProrated` option in `cancelStream` in `services/streaming.js`.
2. Compute prorated fraction to 7 decimal places.
3. Execute final settlement payment if requested by caller.
4. Expose `settleProrated` flag in `DELETE /api/streaming/:id` route.
5. Add integration test verifying prorated settlement upon cancellation.

## Acceptance Criteria
- [ ] Cancelling a stream supports settling prorated partial interval payments.
- [ ] Recipients receive fair compensation for elapsed time prior to cancellation.
- [ ] Final settlement is recorded in total streamed volume.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1375](https://github.com/Ethereal-Future/FuTuRe/issues/1375)
