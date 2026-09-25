# eventSourcing/eventReplayer.js: Event replay does not enforce idempotent projection application, resulting in duplicated aggregate states

**Domain:** Event Sourcing & Projections  
**Complexity:** Hard  
**Labels:** `bug`, `backend`, `architecture`, `resilience`  
**Issue ID:** ISSUE-111

---

## Background
In `backend/src/eventSourcing/eventReplayer.js`, `replayEvents(aggregateId)` fetches events from the event store and applies them to projections:
```javascript
for (const event of events) {
  await projectionManager.applyEvent(event);
}
```

## Problem
- Projections in `projectionManager.js` are not designed as idempotent fold/reducer functions.
- For example, when applying a `PaymentSent` event:
  `account.totalSpent += event.data.amount;`
  `account.paymentCount += 1;`
- If `replayEvents` is triggered to recover from a failure or rebuild a corrupted projection, it re-increments `totalSpent` and `paymentCount` on top of existing values!
- The projection's total balances and payment counts are doubled or multiplied by the number of times replay is run!

## Proposed Solution
1. Store the `lastAppliedEventId` and `lastAppliedVersion` on every projection record.
2. In `applyEvent(projection, event)`:
   `if (event.version <= projection.lastAppliedVersion) return; // skip already applied event`
3. For full projection rebuilds, provide a `rebuildFromGenesis(projectionName)` function that drops the projection to empty initial state before streaming events in order.

## Implementation Steps
1. Add `lastAppliedVersion: Int` to projection schemas.
2. Guard projection mutation with version check: ignore events with `version <= lastAppliedVersion`.
3. Implement `rebuildFromGenesis` resetting state to zero before running `eventReplayer`.
4. Add unit tests asserting that running replay multiple times results in identical aggregate state.

## Acceptance Criteria
- [ ] Projections are idempotent and resist duplicate event applications.
- [ ] Event replay can be executed repeatedly without inflating balances or counts.
- [ ] Rebuilding projections from scratch produces accurate state.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1358](https://github.com/Ethereal-Future/FuTuRe/issues/1358)
