# frontend/hooks/useOfflineQueue.js: Storing offline transactions in localStorage causes silent data loss on quota exceeded

**Domain:** Frontend & Storage  
**Complexity:** Medium  
**Labels:** `bug`, `frontend`, `mobile`, `storage`  
**Issue ID:** ISSUE-177

---

## Background
In `frontend/src/hooks/useOfflineQueue.js`:
Offline transactions are serialized to JSON and stored in browser `localStorage` under `stellar_offline_tx_queue`.

## Problem
- `localStorage` has a synchronous 5MB quota shared across the entire origin.
- When saving multiple signed transaction envelopes with rich metadata, attachments, or transaction memos, `localStorage.setItem` throws `QuotaExceededError`.
- If unhandled or partially written, offline transactions are dropped without notifying the user, leading to lost payments that never synchronize when the device reconnects to the internet.
- Synchronous `localStorage` reads/writes also block the browser UI thread during large queue flushes.

## Proposed Solution
1. Migrate offline transaction persistence from `localStorage` to IndexedDB via `idb` or `localforage`.
2. IndexedDB offers asynchronous non-blocking I/O and hundreds of megabytes of persistent storage.
3. Include transaction retry counters, monotonic local IDs, and atomic state transitions (`QUEUED`, `SYNCING`, `SYNCED`, `FAILED`).

## Implementation Steps
1. Implement IndexedDB storage driver for `useOfflineQueue.js`.
2. Add graceful migration of any existing items from `localStorage` to IndexedDB.
3. Add automated test verifying offline queue handling of 50+ queued transactions without quota errors.

## Acceptance Criteria
- [ ] Offline queue stores data asynchronously in IndexedDB.
- [ ] No quota exceeded exceptions under heavy offline payment queuing.
- [ ] Existing queued items in `localStorage` are safely migrated on app update.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Ensures reliable offline mobile wallet operations.

**GitHub Issue:** [1424](https://github.com/Ethereal-Future/FuTuRe/issues/1424)
