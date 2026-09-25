# eventSourcing/eventStore.js: append method lacks optimistic concurrency check on aggregate version, causing silent lost updates during concurrent writes

**Domain:** Event Sourcing & Projections  
**Complexity:** Hard  
**Labels:** `bug`, `backend`, `architecture`, `concurrency`  
**Issue ID:** ISSUE-110

---

## Background
In event sourcing, aggregate integrity relies on strict sequential versioning (`version: N, version: N+1`).
In `backend/src/eventSourcing/eventStore.js`:
```javascript
async append(aggregateId, event) {
  const record = await prisma.eventStore.create({
    data: {
      aggregateId,
      eventType: event.type,
      payload: event.data ?? {},
      version: event.version ?? 1,
      metadata: event.metadata ?? {},
    },
  });
```

## Problem
- There is no unique constraint on `(aggregateId, version)` in `prisma/schema.prisma`.
- If two processes concurrently load an aggregate at version 5, apply business logic, and append a new event at version 6:
  - Both inserts succeed!
  - The event store now contains two completely different events with `version: 6` for the same aggregate!
  - When the aggregate is replayed, which version 6 event is applied first depends on database insertion order, leading to non-deterministic state and silent data corruption.

## Proposed Solution
1. Add a unique compound constraint on `(aggregateId, version)` in `schema.prisma`: `@@unique([aggregateId, version])`.
2. In `append(aggregateId, event)`, require `expectedVersion`. Query the current max version:
   `if (currentVersion !== expectedVersion) throw new ConcurrencyError(...)`.
3. If concurrent writes race, PostgreSQL rejects the second write with a unique constraint violation (P2002), prompting the caller to reload and retry cleanly.

## Implementation Steps
1. Add `@@unique([aggregateId, version])` to `EventStore` model in `prisma/schema.prisma`.
2. Generate and run database migration.
3. Update `append` signature to `append(aggregateId, event, expectedVersion)`.
4. Catch P2002 unique constraint violations and throw a structured `ConcurrencyError`.
5. Write a concurrent test attempting to append two events with the same version and assert that exactly one succeeds.

## Acceptance Criteria
- [ ] Aggregate events have strictly unique, sequential versions.
- [ ] Concurrent writes for the same version fail with `ConcurrencyError`.
- [ ] Replaying an aggregate produces deterministic state.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1357](https://github.com/Ethereal-Future/FuTuRe/issues/1357)
