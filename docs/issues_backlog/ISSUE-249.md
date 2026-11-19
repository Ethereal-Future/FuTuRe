# backend/src/services/transactionRetry.js: Unbounded memory leak in retryAttempts map on failed transactions

**Domain:** Backend & Performance  
**Complexity:** Medium  
**Labels:** `bug`, `backend`, `performance`, `memory`  
**Issue ID:** ISSUE-249

---

## Background
In `backend/src/services/transactionRetry.js`, `TransactionRetryService` keeps per-transaction attempt history in `this.retryAttempts` (a plain `Map`). Every failed attempt appends to that map:

```js
const attempts = this.retryAttempts.get(transactionId) || [];
attempts.push({ attempt, timestamp: new Date(), error: error.message, errorType: this.classifyError(error) });
this.retryAttempts.set(transactionId, attempts);
```

The only automatic removal is on success (`this.retryAttempts.delete(transactionId)`). The other way to remove entries is `clearRetryHistory()`, which nothing calls automatically.

## Problem
- When a transaction fails for good, either because the error isn't retryable or because `attempt > maxRetries`, the method rethrows and its entry stays in `retryAttempts` forever.
- `backend/src/routes/retry.js` creates one module-level `retryService` that lives as long as the process. Every failed transaction hash adds an entry that is never freed.
- When the circuit breaker is open, each call throws `Circuit breaker is OPEN` and records yet another attempt. An outage therefore speeds up the growth.
- `getRetryStats()` iterates over the whole map, so `GET /api/retry/stats` gets slower as the map grows, and `totalTransactions` counts failures from all time instead of recent activity.

## Proposed Solution
Bound the map by time and by size, and keep failure history long enough to stay useful for `getRetryAttempts()` / metrics:

1. Store each entry as `{ attempts, updatedAt }`, or use a small TTL/LRU structure (e.g. `lru-cache` with `max` and `ttl`, or a hand-rolled `Map` with insertion-order eviction).
2. When a transaction fails for good, keep the entry so callers can still read its history, but mark it `final: true` and let it expire after a configurable `retryHistoryTtlMs` (default e.g. 15 minutes).
3. Enforce `maxTrackedTransactions` (default e.g. 10,000) by evicting the oldest entries when inserting.
4. Run expiry lazily (on insert and in `getRetryStats()`) or on an `unref()`'d interval timer, so the timer never keeps the process alive.
5. Keep the existing success-path `delete` and the `clearRetryHistory()` API.

> A bare `finally { this.retryAttempts.delete(transactionId) }` also stops the leak, but it removes the history right when callers most need it (just after a failure). That breaks `getRetryAttempts()` for failed transactions, so the TTL approach is preferred.

## Implementation Steps
1. Add `retryHistoryTtlMs` and `maxTrackedTransactions` to the constructor config, with defaults and JSDoc.
2. Replace direct `Map` writes with a private `recordAttempt(transactionId, entry)` helper that applies the TTL and the size cap.
3. Have `getRetryAttempts()` and `getRetryStats()` skip or prune expired entries.
4. Add unit tests (with fake timers):
   - a transaction that exhausts retries is still readable via `getRetryAttempts()` right away, and is gone after `retryHistoryTtlMs`;
   - inserting `maxTrackedTransactions + N` distinct failing ids leaves the map size at `maxTrackedTransactions`;
   - calls rejected while the circuit breaker is open don't grow the map without bound.

## Acceptance Criteria
- [ ] Failed transactions do not linger in memory indefinitely.
- [ ] Memory usage remains stable during sustained failed transaction retries.
- [ ] Recent failure history is still available through `getRetryAttempts()` within the configured retention window.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** The service instance is a long-lived singleton exported from `routes/retry.js`, so the leak lasts for the whole process lifetime.
- Also fixed in the same file: [ISSUE-248](./ISSUE-248.md).

**GitHub Issue:** [1563](https://github.com/Ethereal-Future/FuTuRe/issues/1563)
