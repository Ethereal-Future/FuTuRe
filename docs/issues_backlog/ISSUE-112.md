# eventSourcing/eventSerializer.js: Event schema evolution lacks backward and forward compatibility validation against registered event schemas

**Domain:** Event Sourcing & Projections  
**Complexity:** Medium  
**Labels:** `enhancement`, `backend`, `architecture`  
**Issue ID:** ISSUE-112

---

## Background
In `backend/src/eventSourcing/eventSerializer.js`, event payloads are serialized to and deserialized from JSON. Over time, domain events evolve (e.g. `PaymentSent` adds `feeBump` in v2, adds `memoType` in v3).

## Problem
- There is no schema registry or upcaster framework to transform v1 events into the current v3 shape during deserialization.
- When an old v1 event is read by `eventReplayer`, new projection code expecting `event.data.feeBump` crashes with `TypeError: Cannot read properties of undefined`.
- Historical events in the event store are immutable and cannot be modified; without upcasters (event migration functions), old events break modern projections.

## Proposed Solution
Implement an Upcaster Registry in `eventSerializer.js`:
1. Register version migration functions: `registerUpcaster('PaymentSent', 1, (data) => ({ ...data, feeBump: false, version: 2 }))`.
2. When deserializing an event with `version < CURRENT_VERSION`, run it sequentially through the registered upcaster chain until it reaches the latest version.
3. Validate final event structure against the latest Zod event schema before passing to projections.

## Implementation Steps
1. Create `UpcasterRegistry` class in `backend/src/eventSourcing/eventSerializer.js`.
2. Define migration functions for all historical event versions.
3. Apply upcasters automatically during `deserializeEvent(event)`.
4. Add tests verifying that a v1 event is correctly upgraded to v3 format on read.

## Acceptance Criteria
- [ ] Historical events with older schemas are upgraded seamlessly on read.
- [ ] Projections only need to handle the latest event schema version.
- [ ] Immutable historical event records are preserved in their original format.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1359](https://github.com/Ethereal-Future/FuTuRe/issues/1359)
