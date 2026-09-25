# mobile/offlineQueue.js: Unbounded queue growth allows malicious users to exhaust server memory by spamming offline queue endpoints

**Domain:** Mobile & Offline Resilience  
**Complexity:** Medium  
**Labels:** `bug`, `mobile`, `security`, `rate-limiting`  
**Issue ID:** ISSUE-131

---

## Background
In `backend/src/mobile/offlineQueue.js`:
```javascript
enqueue(userId, transaction) {
  if (!this.queues.has(userId)) this.queues.set(userId, []);
  ...
  this.queues.get(userId).push(item);
  return item;
}
```
There is no maximum queue length per user or global queue depth limit.

## Problem
- An attacker can authenticate as a user and loop `POST /mobile/queue/enqueue` millions of times with large payload strings.
- Because `this.queues.get(userId)` has no capacity ceiling, it will consume hundreds of megabytes of process memory.
- This creates an easy Denial of Service (DoS) vector causing Node.js Out-Of-Memory (OOM) heap crashes for the entire backend.

## Proposed Solution
1. Enforce a strict per-user queue limit: `MAX_QUEUE_ITEMS_PER_USER = 50`.
2. Enforce a maximum payload size per transaction: `MAX_PAYLOAD_BYTES = 10_000` (10KB).
3. If queue capacity is exceeded, reject with HTTP 429 Too Many Requests: `error: 'Offline queue limit reached (max 50 items)'`.
4. Add rate limiting to the `/mobile/queue/enqueue` endpoint.

## Implementation Steps
1. Define `MAX_OFFLINE_QUEUE_ITEMS = 50` constant in `offlineQueue.js`.
2. Validate current queue depth before inserting new items.
3. Validate payload byte size in request validation middleware.
4. Add tests verifying rejection when queue limit is exceeded.

## Acceptance Criteria
- [ ] Per-user offline queue size is strictly capped at 50 items.
- [ ] Payload size per queued item is bounded.
- [ ] Memory exhaustion via queue flooding is prevented.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1378](https://github.com/Ethereal-Future/FuTuRe/issues/1378)
