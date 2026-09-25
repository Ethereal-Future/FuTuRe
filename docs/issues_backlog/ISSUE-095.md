# webhooks/dispatcher.js: processDueWebhookDeliveries lacks SELECT FOR UPDATE SKIP LOCKED, causing duplicate webhook dispatches across instances

**Domain:** Webhooks & Delivery  
**Complexity:** Hard  
**Labels:** `bug`, `webhooks`, `concurrency`, `backend`  
**Issue ID:** ISSUE-095

---

## Background
In `backend/src/webhooks/dispatcher.js`, `processDueWebhookDeliveries` is called by the background scheduler to retry pending deliveries (lines 135-150):
```javascript
export async function processDueWebhookDeliveries() {
  const due = await prisma.webhookDelivery.findMany({
    where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
    take: 100,
  });

  for (const delivery of due) {
    try {
      await attemptDelivery(delivery);
    } catch (err) { ... }
  }
...
```

## Problem
- When multiple backend instances run concurrently in ECS:
  1. Instance 1 and Instance 2 trigger `processDueWebhookDeliveries` around the same second.
  2. Both instances run `findMany({ where: { status: 'PENDING', ... } })`.
  3. Both instances fetch the exact same 100 pending webhook delivery rows!
  4. Both instances call `attemptDelivery(delivery)` for every single row.
- Every subscriber server receives duplicate HTTP POST webhooks for the exact same event!
- If the subscriber server is not idempotent, duplicate deliveries cause double crediting, duplicate order fulfillment, or alert storms.

## Proposed Solution
Use PostgreSQL's native row-level concurrency queue pattern: `SELECT ... FOR UPDATE SKIP LOCKED`:
1. Use an interactive transaction or raw SQL query to claim rows atomically:
```sql
UPDATE webhook_deliveries
SET status = 'PROCESSING', updated_at = NOW()
WHERE id IN (
  SELECT id FROM webhook_deliveries
  WHERE status = 'PENDING' AND next_attempt_at <= NOW()
  ORDER BY next_attempt_at ASC
  LIMIT 50
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```
2. Each instance claims a disjoint, non-overlapping batch of rows.
3. No two instances can ever claim or process the same delivery row.

## Implementation Steps
1. Replace Prisma `findMany` in `processDueWebhookDeliveries` with an atomic raw query using `FOR UPDATE SKIP LOCKED`.
2. Transition claimed rows immediately to `PROCESSING` status.
3. Execute `attemptDelivery` only on claimed rows.
4. On completion, transition status to `DELIVERED` or reschedule to `PENDING`.
5. Add multi-process concurrency test verifying zero duplicate deliveries.

## Acceptance Criteria
- [ ] Parallel instances never process the same webhook delivery row.
- [ ] `FOR UPDATE SKIP LOCKED` prevents lock contention and blocking.
- [ ] Subscribers receive each webhook event exactly once per attempt.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1342](https://github.com/Ethereal-Future/FuTuRe/issues/1342)
