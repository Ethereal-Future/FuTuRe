# frontend/components/ErrorBoundary.jsx: Persistent crash loops caused by failure to reset corrupted localStorage state

**Domain:** Frontend & Resilience  
**Complexity:** Medium  
**Labels:** `bug`, `frontend`, `resilience`  
**Issue ID:** ISSUE-185

---

## Background
In `frontend/src/components/ErrorBoundary.jsx`:
When an uncaught JavaScript error occurs during rendering, `ErrorBoundary` displays a fallback UI with a "Reload Page" button.

## Problem
- Many rendering crashes are caused by corrupted cached data stored in `localStorage` (e.g. malformed JSON in `stellar_recent_txs`, invalid state in `app_settings`, or outdated schema in cached balances).
- When the user clicks "Reload Page", the page reloads, reads the exact same corrupted `localStorage` payload, and crashes again immediately.
- The user is trapped in an inescapable infinite crash loop, and the only escape is manually clearing browser storage via developer tools!

## Proposed Solution
1. Provide a "Clear Cache & Reset" button on the error boundary UI.
2. In the reset action, clear app-specific localStorage keys (while preserving private key credentials if securely stored) and reload.
3. Automatically log error stack and component trace to the remote logger (`/api/monitoring/errors`).

## Implementation Steps
1. Add "Reset Wallet Cache" option in `frontend/src/components/ErrorBoundary.jsx`.
2. Implement safe cache purge utility that clears corrupted state keys.
3. Add unit test verifying reset button clears storage and reloads.

## Acceptance Criteria
- [ ] Fallback UI provides clear reset option to break infinite crash loops.
- [ ] Corrupted cache keys are purged safely without deleting critical credentials.
- [ ] Error reports are automatically dispatched to monitoring.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Crucial self-healing mechanism for production frontend reliability.

**GitHub Issue:** [1432](https://github.com/Ethereal-Future/FuTuRe/issues/1432)
