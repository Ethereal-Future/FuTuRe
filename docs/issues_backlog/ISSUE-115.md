# eventSourcing/projectionManager.js: Projections lack snapshotting mechanism, requiring full event log replay from genesis on every cold boot

**Domain:** Event Sourcing & Projections  
**Complexity:** Hard  
**Labels:** `enhancement`, `backend`, `performance`, `architecture`  
**Issue ID:** ISSUE-115

---

## Background
In `backend/src/eventSourcing/projectionManager.js`, projections (such as account balances, payment histories, and user summaries) maintain read-model aggregates.
Currently, rebuilding a projection requires loading every event from genesis (`version = 0`).

## Problem
- When an account has 50,000 transaction events, replaying from genesis requires loading and folding 50,000 individual event rows into memory.
- Startup times for projection rebuilding grow linearly with total system lifetime.
- Under high transaction volumes, rebuilding projections takes hours, causing extended downtime during database recovery or cold restarts.

## Proposed Solution
Implement Aggregate Snapshotting:
1. Every N events (e.g. every 500 events), save a serialized snapshot of the aggregate state to a `Snapshot` table (`aggregateId, version, state, createdAt`).
2. When rebuilding or replaying an aggregate:
   - Query the latest snapshot: `findFirst({ where: { aggregateId }, orderBy: { version: 'desc' } })`.
   - If snapshot exists at version V, load only events where `version > V`.
   - Apply only the incremental delta events on top of the snapshot.
3. This reduces replay time from O(N) to O(1) bounded by snapshot frequency.

## Implementation Steps
1. Create `Snapshot` model in `prisma/schema.prisma` with unique constraint on `(aggregateId, version)`.
2. In `eventStore.append`, trigger snapshot creation when `version % 500 === 0`.
3. Update `eventReplayer.replayEvents` to load latest snapshot first.
4. Add tests verifying that replay from snapshot produces identical results to full replay from genesis.

## Acceptance Criteria
- [ ] Snapshots are automatically saved at regular version intervals.
- [ ] Aggregate reloads use snapshots to avoid full log replay.
- [ ] Replay latency is reduced by >95% for long-lived aggregates.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1362](https://github.com/Ethereal-Future/FuTuRe/issues/1362)
