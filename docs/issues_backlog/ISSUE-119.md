# services/streaming.js: processActiveStreams double-payment race condition across multi-instance ECS deployments due to lack of distributed locking

**Domain:** Payment Streaming  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `concurrency`, `critical-bug`  
**Issue ID:** ISSUE-119

---

## Background
In `backend/src/services/streaming.js`, `processActiveStreams` is called by background scheduler ticks (lines 269-301):
```javascript
export async function processActiveStreams() {
  const now = new Date();
  const activeStreams = await prisma.paymentStream.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ endTime: null }, { endTime: { gt: now } }],
    },
    include: { sender: true, recipient: true },
  });

  for (const stream of activeStreams) {
    const lastProcessed = new Date(stream.lastProcessedAt);
    const secondsSinceLast = (now - lastProcessed) / 1000;

    if (secondsSinceLast >= stream.intervalSeconds) {
       // Executes sendPayment on Stellar!
       const result = await sendPayment(senderSecret, stream.recipient.publicKey, ...);
```

## Problem
- When multiple ECS backend tasks run in parallel in production:
  1. Task 1 and Task 2 both execute `processActiveStreams` on the same 10-second tick.
  2. Both tasks query `prisma.paymentStream.findMany` and fetch the exact same active streams.
  3. Both tasks check `secondsSinceLast >= stream.intervalSeconds` (both evaluate to `true`).
  4. Both tasks simultaneously call `sendPayment(...)` using the sender's secret key!
- The sender sends **DOUBLE (or TRIPLE)** the intended payment amount to the recipient!
- There is NO distributed lock (e.g. Redis Redlock), NO database row lock (`SELECT FOR UPDATE`), and NO atomic status update to `PROCESSING` before initiating the payment.
- This is a catastrophic financial loss and overpayment vulnerability.

## Proposed Solution
Implement a distributed lock or atomic database claim before executing stream payments:
1. Use Redis distributed locking: `const lock = await redisLock.acquire("stream:lock:" + stream.id, 30000)`. If lock fails, skip processing.
2. Alternatively, use an atomic database timestamp advance:
```javascript
const claimed = await prisma.paymentStream.updateMany({
  where: {
    id: stream.id,
    status: 'ACTIVE',
    lastProcessedAt: stream.lastProcessedAt, // optimistic concurrency check
  },
  data: {
    lastProcessedAt: now,
  }
});
if (claimed.count === 0) continue; // claimed by another worker
```
3. Only the instance that successfully claims the lock/timestamp executes `sendPayment`.

## Implementation Steps
1. Add distributed locking via Redis `SETNX` in `backend/src/services/streaming.js` before payment execution.
2. Advance `lastProcessedAt` before submitting transaction to prevent concurrent ticks from claiming the stream.
3. If payment submission fails, revert `lastProcessedAt` or record failure count.
4. Write a concurrency test simulating 3 parallel workers running `processActiveStreams` and assert exactly 1 payment executes per interval.

## Acceptance Criteria
- [ ] Payment streams execute exactly once per configured interval across multi-instance clusters.
- [ ] Parallel workers never double-send payments.
- [ ] Concurrency race condition is eliminated.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1366](https://github.com/Ethereal-Future/FuTuRe/issues/1366)
