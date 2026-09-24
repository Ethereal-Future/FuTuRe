# eventSourcing/eventStore.js: Syntax error on line 53 from missing closing brace prevents event store module execution

**Domain:** Event Sourcing & Projections  
**Complexity:** Hard  
**Labels:** `bug`, `backend`, `critical-bug`, `architecture`  
**Issue ID:** ISSUE-107

---

## Background
In `backend/src/eventSourcing/eventStore.js` (lines 45-56):
```javascript
  async append(aggregateId, event) {
    if (!this.initialized) await this.initialize();

    const eventWithMetadata = {
      id: randomUUID(),
      aggregateId,
      type: event.type,
      data: event.data,
      version: event.version || 1,
      timestamp: new Date().toISOString(),
      metadata: event.metadata || {}
    const record = await prisma.eventStore.create({
      data: {
```
The object literal `eventWithMetadata` is missing its closing brace `};` before declaring `const record`.

## Problem
- Running `node -c backend/src/eventSourcing/eventStore.js` fails with:
  `SyntaxError: Unexpected token 'const'`
- Any service calling `eventMonitor.publishEvent()` or appending events (e.g. `sendPayment` in `services/stellar.js`, `createStream` in `services/streaming.js`, `createMultiSigAccount` in `services/multiSig.js`) crashes on module import.
- The entire event-sourcing subsystem is completely inoperable at runtime due to this syntax error.

## Proposed Solution
Clean up the incomplete `eventWithMetadata` variable declaration in `backend/src/eventSourcing/eventStore.js`. Either close the object or construct the object directly within `prisma.eventStore.create()`. Verify syntax passes `node -c` cleanly.

## Implementation Steps
1. Open `backend/src/eventSourcing/eventStore.js` and fix the syntax error at line 52.
2. Remove redundant unused `eventWithMetadata` variable.
3. Run `node -c backend/src/eventSourcing/eventStore.js`.
4. Add a regression test checking that `append()` successfully persists events to `prisma.eventStore`.

## Acceptance Criteria
- [ ] `backend/src/eventSourcing/eventStore.js` parses cleanly without syntax errors.
- [ ] `append()` executes and returns the created event record.
- [ ] All services publishing events can load and execute without syntax errors.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1354](https://github.com/Ethereal-Future/FuTuRe/issues/1354)
