# routes/events.js: Duplicate identifier requireAdmin syntax error prevents mounting of events API routes

**Domain:** Event Sourcing & Projections  
**Complexity:** Medium  
**Labels:** `bug`, `backend`, `critical-bug`, `middleware`  
**Issue ID:** ISSUE-116

---

## Background
In `backend/src/routes/events.js` (line 17):
```javascript
import { requireAuth, requireAdmin, requireOwnAccount } from '../middleware/auth.js';
                      ^^^^^^^^^^^^
SyntaxError: Identifier 'requireAdmin' has already been declared
```
`requireAdmin` is imported on line 5 from `../middleware/adminAuth.js` and imported a second time on line 17 from `../middleware/auth.js`.

## Problem
- Running `node -c backend/src/routes/events.js` fails with:
  `SyntaxError: Identifier 'requireAdmin' has already been declared`
- Express fails to mount `/api/v1/events` on application startup.
- All event sourcing API routes (event history, aggregate queries, projection status) crash with module import errors.

## Proposed Solution
Remove the redundant duplicate import of `requireAdmin` in `backend/src/routes/events.js`. Standardize on importing admin authorization from `backend/src/middleware/adminAuth.js`. Verify file passes `node -c`.

## Implementation Steps
1. Open `backend/src/routes/events.js` and remove `requireAdmin` from line 17.
2. Run `node -c backend/src/routes/events.js`.
3. Add tests verifying all routes in `routes/events.js` mount and respond correctly.

## Acceptance Criteria
- [ ] `routes/events.js` compiles without duplicate identifier errors.
- [ ] Event routes mount successfully in Express server.
- [ ] Route tests pass in CI.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1363](https://github.com/Ethereal-Future/FuTuRe/issues/1363)
