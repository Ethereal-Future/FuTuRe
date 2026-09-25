# eventSourcing/projectionManager.js: Event projection processing lacks poison-pill message dead-lettering, stalling projection pipeline on unhandled errors

**Domain:** Event Sourcing & Projections  
**Complexity:** Hard  
**Labels:** `bug`, `backend`, `resilience`, `architecture`  
**Issue ID:** ISSUE-118

---

## Background
In `backend/src/eventSourcing/projectionManager.js`, `project(name, events)` processes an ordered sequence of events to update a projection. If an event contains unexpected or corrupt data (a "poison-pill" event), the projection handler throws an exception.

## Problem
- When an event throws an unhandled error during projection processing:
  - The projection pipeline halts at that event.
  - On the next retry tick, the projection manager attempts to process the exact same corrupt event, and crashes again.
  - The entire projection is permanently frozen at version N, and all subsequent events for all users are stalled indefinitely behind the poison-pill event.
- There is no dead-lettering or quarantine mechanism for malformed events.

## Proposed Solution
Implement a Poison-Pill Quarantine & DLQ mechanism:
1. Track retry attempts for each event in the projection pipeline: `event.retryCount`.
2. If an event fails projection processing 3 consecutive times:
   - Log a critical alert: `logger.fatal({ event, error }, 'Poison-pill event quarantined')`.
   - Move the event record to `ProjectionPoisonPill` table with error stack trace.
   - Increment a metric `projection_poison_pill_quarantined_total`.
   - Skip the quarantined event and continue processing subsequent healthy events.
3. Provide an admin endpoint to repair and replay quarantined events.

## Implementation Steps
1. Create `ProjectionPoisonPill` model in Prisma schema.
2. Add try/catch with retry counter in `projectionManager.js`.
3. Quarantine events failing after 3 attempts.
4. Expose admin route `POST /api/events/poison-pills/:id/retry`.
5. Add tests verifying that a single bad event does not halt processing of subsequent events.

## Acceptance Criteria
- [ ] Malformed events are quarantined without stalling the projection pipeline.
- [ ] Subsequent valid events continue to be processed.
- [ ] Admins receive alerts with full diagnostics for quarantined events.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1365](https://github.com/Ethereal-Future/FuTuRe/issues/1365)
