# eventSourcing/eventArchiver.js: Syntax error on line 46 from illegal return statement outside function crashes module loading

**Domain:** Event Sourcing & Projections  
**Complexity:** Hard  
**Labels:** `bug`, `backend`, `critical-bug`, `database`  
**Issue ID:** ISSUE-109

---

## Background
In `backend/src/eventSourcing/eventArchiver.js` (line 46):
```javascript
      return archivedCount;
      ^^^^^^
SyntaxError: Illegal return statement
```
A `return` statement is located outside of any function declaration or method body due to misplaced closing braces.

## Problem
- Running `node -c backend/src/eventSourcing/eventArchiver.js` fails immediately with `SyntaxError: Illegal return statement`.
- The event archiver worker cannot start, preventing background archival of historical events.
- Hot event store tables in PostgreSQL cannot be pruned, leading to continuous table growth.

## Proposed Solution
Correct the method boundaries in `backend/src/eventSourcing/eventArchiver.js`. Ensure `return archivedCount;` is properly contained inside the `archiveEvents()` method block. Verify syntax with `node -c`.

## Implementation Steps
1. Correct method block indentation and brace matching in `backend/src/eventSourcing/eventArchiver.js`.
2. Verify with `node -c backend/src/eventSourcing/eventArchiver.js`.
3. Add integration test verifying archival of older events into archive partitions.

## Acceptance Criteria
- [ ] `eventArchiver.js` parses cleanly without syntax errors.
- [ ] `archiveEvents()` executes and returns the count of archived rows.
- [ ] Scheduled event archival task runs without crashing.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1356](https://github.com/Ethereal-Future/FuTuRe/issues/1356)
