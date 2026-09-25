# compliance/rules.js: createStreamAnalyzer maintains unbounded in-memory per-sender state maps without LRU eviction, leading to OOM

**Domain:** Compliance & AML  
**Complexity:** Hard  
**Labels:** `bug`, `compliance`, `performance`, `backend`  
**Issue ID:** ISSUE-092

---

## Background
In `backend/src/compliance/rules.js`, `createStreamAnalyzer` maintains a streaming state for each sender (lines 161-178):
```javascript
export function createStreamAnalyzer() {
  const states = new Map();
  const flags = [];

  function stateFor(senderId) {
    let state = states.get(senderId);
    if (!state) {
      state = {
        day: [],
        hour: [],
        sum: 0,
        smallCount: 0,
        rapidFlagged: false,
      };
      states.set(senderId, state);
    }
    return state;
  }
...
```

## Problem
- `states` is an unbounded in-memory `Map()`.
- Every unique sender ID that has ever transacted is permanently retained in `states`.
- Even when all transactions in `state.day` and `state.hour` have aged out past 24 hours, the sender's empty state object remains in the Map indefinitely.
- Over months of continuous operation across hundreds of thousands of users, `states.size` grows monotonically, causing steady heap growth and eventual Out-Of-Memory (OOM) crashes.

## Proposed Solution
1. Clean up empty sender states: after `evictHead`, if `state.day.length === 0 && state.hour.length === 0`, delete the sender entry: `states.delete(senderId)`.
2. Wrap `states` in an LRU cache (`lru-cache` with `max: 50000` items) to guarantee hard memory bounds.
3. For long-term historical streaming analysis, persist sliding window counters in Redis with 24-hour expiration (`EXPIRE`).

## Implementation Steps
1. Update `process(tx)` in `rules.js` to delete `state` from `states` when both queues become empty.
2. Use `LRUCache` with bounded maximum entries for active sender state tracking.
3. Add memory leak unit test running 100,000 distinct sender transactions and asserting heap memory remains stable.

## Acceptance Criteria
- [ ] Sender states with no active window transactions are evicted from memory.
- [ ] Total tracked senders in memory is strictly bounded by LRU capacity.
- [ ] Heap memory usage remains flat under continuous transaction streams.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1339](https://github.com/Ethereal-Future/FuTuRe/issues/1339)
