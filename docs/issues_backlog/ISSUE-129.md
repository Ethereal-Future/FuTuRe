# mobile/offlineQueue.js: Offline transaction queue lives in volatile process memory, losing queued user payments on container restarts

**Domain:** Mobile & Offline Resilience  
**Complexity:** Hard  
**Labels:** `bug`, `mobile`, `resilience`, `critical-bug`  
**Issue ID:** ISSUE-129

---

## Background
In `backend/src/mobile/offlineQueue.js`:
```javascript
class OfflineQueue {
  constructor() {
    // userId -> ordered array of queued transactions
    this.queues = new Map();
  }

  enqueue(userId, transaction) {
    if (!this.queues.has(userId)) this.queues.set(userId, []);
    const item = { id: crypto.randomUUID(), userId, transaction, ... };
    this.queues.get(userId).push(item);
    return item;
  }
...
```
The queue is an in-memory `Map` on a singleton class instance.

## Problem
- Mobile users enqueue transactions while offline in areas with poor cellular connectivity, intending for the server to process them when connectivity is restored.
- In production:
  1. Container restarts, redeployments, or task crashes completely erase `this.queues`.
  2. Multi-instance ECS deployments: a user calling `/mobile/queue/enqueue` hits Task A, but their subsequent `/mobile/queue/flush` hits Task B. Task B's in-memory Map is empty, so zero transactions are flushed!
  3. Queued transactions are silently lost without trace, causing users' payments to vanish without notification.

## Proposed Solution
Migrate `OfflineQueue` to PostgreSQL and Redis:
1. Define a `MobileOfflineQueueItem` model in Prisma (`id, userId, transactionData, status, enqueuedAt, processedAt, error`).
2. Store queued items in a Redis list `mobile:queue:${userId}` for fast FIFO processing.
3. Synchronize queue state across all backend instances via Redis and database persistence.
4. Guarantee that queued items survive server restarts and can be flushed from any cluster node.

## Implementation Steps
1. Create `MobileOfflineQueueItem` model in `prisma/schema.prisma`.
2. Refactor `offlineQueue.js` to persist items to PostgreSQL and Redis.
3. Implement atomic FIFO pop/processing in `/mobile/queue/flush`.
4. Add multi-instance tests verifying enqueue on instance 1 can be flushed from instance 2.

## Acceptance Criteria
- [ ] Offline queue items are durably stored across container restarts.
- [ ] Any cluster node can flush queued transactions.
- [ ] User transactions are never lost during server redeployments.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1376](https://github.com/Ethereal-Future/FuTuRe/issues/1376)
