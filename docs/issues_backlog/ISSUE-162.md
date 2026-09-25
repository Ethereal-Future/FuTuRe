# chaos/databaseFailureSimulator.js: Lingering `setTimeout` recovery callbacks cause test hangs and unhandled rejections

**Domain:** Chaos Engineering & Testing  
**Complexity:** Medium  
**Labels:** `bug`, `testing`, `async`  
**Issue ID:** ISSUE-162

---

## Background
In `backend/src/chaos/databaseFailureSimulator.js` (lines 18-22):
```javascript
    if (recoveryTime) {
      setTimeout(() => {
        this.recoverDatabase(databaseId);
      }, recoveryTime);
    }
```
When simulating temporary database failures, a recovery timer is scheduled via standard `setTimeout`.

## Problem
- If a test suite finishes early, times out, or fails assertion, the scheduled `setTimeout` remains active in the Node.js event loop.
- Jest/Mocha processes hang at completion with "A worker process has failed to exit gracefully and has been force exited".
- If the database simulator is destroyed or reset, the callback fires against a stale object, causing unhandled promise rejections or modifying database state after tests have finished.

## Proposed Solution
1. Track all scheduled recovery timers in a `Set` or `Map` (`this.activeTimers`).
2. Implement a `reset()` / `dispose()` method that explicitly calls `clearTimeout` on all pending timers.
3. Call `.unref()` on scheduled timers so they do not keep the Node.js process alive unnecessarily.

## Implementation Steps
1. Update `failDatabase` in `backend/src/chaos/databaseFailureSimulator.js` to store timer references.
2. Add `.unref()` to the timer handle.
3. Add `reset()` method to clear all active timers during test teardown.
4. Add unit test verifying clean exit without hanging timers.

## Acceptance Criteria
- [ ] All scheduled recovery timers can be cleared via `reset()`.
- [ ] Timers do not prevent the Node.js event loop from exiting naturally.
- [ ] Test suites finish cleanly without forced termination warnings.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Prevents CI test runner hangs and flake.

**GitHub Issue:** [1409](https://github.com/Ethereal-Future/FuTuRe/issues/1409)
