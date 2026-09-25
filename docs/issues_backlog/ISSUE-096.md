# webhooks/dispatcher.js: Sequential delivery loop in processDueWebhookDeliveries blocks Node.js event loop during downstream endpoint timeouts

**Domain:** Webhooks & Delivery  
**Complexity:** Hard  
**Labels:** `bug`, `webhooks`, `performance`, `backend`  
**Issue ID:** ISSUE-096

---

## Background
In `backend/src/webhooks/dispatcher.js`:
```javascript
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    take: 100,
  });

  for (const delivery of due) {
    try {
      await attemptDelivery(delivery);
    } catch (err) { ... }
  }
```
`deliverOnce` sets a timeout of 5,000ms: `signal: AbortSignal.timeout(5000)`.

## Problem
- The `for (const delivery of due)` loop uses `await` sequentially on each delivery.
- If 15 webhook subscriber endpoints are down, unresponsive, or experiencing network blackholes:
  - Each timed-out endpoint waits the full 5,000ms.
  - 15 slow endpoints * 5 seconds = **75 seconds** of sequential blocking in a single iteration!
- During these 75 seconds, other pending deliveries are starved and delayed, the scheduler tick falls behind, and the worker process is monopolized by dead connections.

## Proposed Solution
Execute deliveries with controlled parallelism using a concurrency pool (e.g. `p-limit` or worker queue):
```javascript
import pLimit from 'p-limit';
const limit = pLimit(10); // max 10 parallel webhook dispatches
await Promise.allSettled(due.map(delivery => limit(() => attemptDelivery(delivery))));
```
10 parallel connections reduce 75 seconds of timeouts down to ~7.5 seconds.

## Implementation Steps
1. Integrate `p-limit` with concurrency limit of 10 in `webhooks/dispatcher.js`.
2. Refactor sequential `for..of` loop to `Promise.allSettled(due.map(...))`.
3. Add per-host concurrency throttling to prevent flooding a single subscriber's server with 10 parallel connections.
4. Add benchmark test verifying 50 deliveries with simulated latency complete in parallel.

## Acceptance Criteria
- [ ] Webhook deliveries execute in parallel with bounded concurrency.
- [ ] Slow or dead subscriber endpoints do not block processing of healthy webhooks.
- [ ] Batch execution time scales sub-linearly with batch size.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1343](https://github.com/Ethereal-Future/FuTuRe/issues/1343)
