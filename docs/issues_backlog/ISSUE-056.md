# db/client.js: Promise.race query timeout creates unbounded uncollected setTimeout timer objects, causing memory leaks under high QPS

**Domain:** Database & Persistence  
**Complexity:** Hard  
**Labels:** `bug`, `database`, `performance`, `backend`  
**Issue ID:** ISSUE-056

---

## Background
In `backend/src/db/client.js`, a query timeout extension is applied to Prisma queries (lines 69-83):
```javascript
const prisma = baseClient.$extends(createSoftDeleteExtension()).$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const timeout = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`DB query timed out after ${QUERY_TIMEOUT_MS}ms`)),
            QUERY_TIMEOUT_MS
          )
        );
        return Promise.race([query(args), timeout]);
      },
    },
  },
});
```

## Problem
- When `query(args)` resolves successfully in e.g. 5ms, the `setTimeout` timer is NEVER cancelled (`clearTimeout`).
- The timer remains registered in the Node.js event loop timer wheel/list for the full 5,000ms duration of `QUERY_TIMEOUT_MS`.
- Under high throughput (e.g. 500 queries/second), there are constantly 2,500+ active timer closures and pending promise references held in memory.
- Over time, this causes significant garbage collection overhead, event loop latency spikes, and heap bloat.
- Furthermore, if `timeout` rejects first, the underlying `query(args)` continues running in the background, and if it subsequently rejects or throws, it triggers an unhandled promise rejection in Node.js.

## Proposed Solution
Store the `timer` handle and call `clearTimeout(timer)` in a `finally` block or completion handler:
```javascript
let timer;
const timeout = new Promise((_, reject) => {
  timer = setTimeout(
    () => reject(new Error(`DB query timed out after ${QUERY_TIMEOUT_MS}ms`)),
    QUERY_TIMEOUT_MS
  );
});
try {
  return await Promise.race([query(args), timeout]);
} finally {
  clearTimeout(timer);
}
```

## Implementation Steps
1. Update the `$allOperations` wrapper in `backend/src/db/client.js` to store the timer reference.
2. Add `finally { clearTimeout(timer); }` to guarantee immediate timer cleanup upon query resolution or rejection.
3. Catch late rejections on the loser promise to prevent unhandled rejection warnings.
4. Write a benchmark test executing 1,000 queries in rapid succession and asserting timer count returns to zero.

## Acceptance Criteria
- [ ] Timers are immediately cleared when queries complete before the timeout.
- [ ] Memory usage does not scale linearly with query volume.
- [ ] No unhandled promise rejection warnings occur on slow queries.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1303](https://github.com/Ethereal-Future/FuTuRe/issues/1303)
