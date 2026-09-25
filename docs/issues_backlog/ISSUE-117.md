# eventSourcing/eventStore.js: Aggregate event queries lack pagination, causing memory exhaustion when querying high-frequency accounts

**Domain:** Event Sourcing & Projections  
**Complexity:** Medium  
**Labels:** `bug`, `backend`, `performance`  
**Issue ID:** ISSUE-117

---

## Background
In `backend/src/eventSourcing/eventStore.js`, `getEvents` loads all events for an aggregate (lines 80-98):
```javascript
async getEvents(aggregateId, fromVersion = 0) {
  const records = await prisma.eventStore.findMany({
    where: {
      aggregateId,
      version: { gt: fromVersion },
    },
    orderBy: { createdAt: 'asc' },
  });
...
```

## Problem
- There is no `take`, `limit`, or pagination parameter on `getEvents`.
- High-volume accounts (such as the platform hot wallet or high-frequency DEX traders) accumulate hundreds of thousands of events.
- Calling `getEvents(hotWalletPublicKey)` queries 100,000+ rows in a single query, deserializing hundreds of megabytes of JSON into Node memory.
- This causes memory exhaustion, slow queries, and HTTP request timeouts on event query endpoints.

## Proposed Solution
1. Add pagination parameters to `getEvents(aggregateId, options = {})`: `fromVersion`, `limit = 100`, `cursor`.
2. Implement cursor-based pagination using the event `version` or `id`.
3. Provide an asynchronous stream/generator `streamEvents(aggregateId, options)` for background processes needing to iterate over large event sets without loading all records into memory at once.

## Implementation Steps
1. Update `getEvents` to accept `limit` (default 100, max 1000).
2. Implement `streamEvents` generator using Prisma batch cursor pagination.
3. Update route `/api/v1/events/:aggregateId` to accept `limit` and `cursor` query parameters.
4. Add tests verifying pagination ordering and limits.

## Acceptance Criteria
- [ ] Event queries are strictly bounded by pagination limits.
- [ ] Async streaming enables memory-efficient traversal of large event logs.
- [ ] Heap memory spikes during event history queries are eliminated.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1364](https://github.com/Ethereal-Future/FuTuRe/issues/1364)
