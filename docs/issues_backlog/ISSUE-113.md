# eventSourcing/eventMonitor.js: In-process event monitor listener errors are silently caught, preventing detection of broken projection updates

**Domain:** Event Sourcing & Projections  
**Complexity:** Medium  
**Labels:** `bug`, `backend`, `observability`, `error-handling`  
**Issue ID:** ISSUE-113

---

## Background
In `backend/src/eventSourcing/eventMonitor.js`, `publishEvent` notifies registered subscribers (such as projection managers and analytics handlers):
```javascript
for (const listener of listeners) {
  try {
    await listener(event);
  } catch (error) {
    logger.warn({ error: error.message }, 'Listener threw an error');
  }
}
```

## Problem
- When a projection listener fails (e.g. database deadlocks, unique constraint violations, or unexpected data types):
  - The error is swallowed with a brief warning log.
  - The event publishing method reports success to the caller.
  - The projection is now permanently desynchronized from the event store, with no mechanism to track that this projection missed event N.
- Operators have no automated alerts indicating that CQRS projections are lagging or failing.

## Proposed Solution
1. Track projection lag and error status in `ProjectionStatus` table.
2. When a listener fails, record the failed event in a projection Dead Letter Queue (`projection:dlq:${projectionName}`).
3. Emit a Prometheus error counter `projection_update_failed_total{projection=name, eventType=type}` to trigger alerting.
4. Expose a healthcheck endpoint `GET /api/events/projections/status` reporting projection sync health.

## Implementation Steps
1. Update `eventMonitor.publishEvent` to route failed listener updates to a retry/DLQ queue.
2. Increment Prometheus error counter on listener failures.
3. Expose projection health API endpoint in `routes/events.js`.
4. Add tests verifying error capture and metric emission when listener throws.

## Acceptance Criteria
- [ ] Projection update failures are recorded in a dead-letter queue rather than ignored.
- [ ] Prometheus metrics alert operators to projection desynchronization.
- [ ] CQRS read models maintain verifiable consistency.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1360](https://github.com/Ethereal-Future/FuTuRe/issues/1360)
