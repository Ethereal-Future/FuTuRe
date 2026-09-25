# frontend/components/NotificationPreferences.jsx: Unchecked optimistic UI updates leave notification toggles out of sync on API failure

**Domain:** Frontend & State  
**Complexity:** Medium  
**Labels:** `bug`, `frontend`, `ui`  
**Issue ID:** ISSUE-179

---

## Background
In `frontend/src/components/NotificationPreferences.jsx`:
When a user toggles an alert preference (e.g. "Email on payment received", "Push on security incident"), the toggle switch immediately updates its visual state and fires an async API request to `/api/notifications/preferences`.

## Problem
- If the network request fails (e.g. 500 error, offline, CSRF expired), the catch block logs the error to console or displays a toast, but NEVER reverts the toggle switch!
- The user sees the toggle as "ON" and assumes they are subscribed to critical security alerts, when in reality the database still has the preference disabled!
- In an emergency (e.g. unauthorized withdrawal), the user never receives the security notification.

## Proposed Solution
1. Store previous preference state before initiating optimistic updates.
2. In the `.catch()` block, immediately roll back the state to the previous value.
3. Display an inline retry banner and clear error message alerting the user that the preference change failed to save.

## Implementation Steps
1. Add rollback logic to toggle handler in `NotificationPreferences.jsx`.
2. Add unit tests simulating network error and asserting switch reverts to previous state.
3. Add visual indicator during in-flight preference saves.

## Acceptance Criteria
- [ ] Toggle switches automatically revert if the backend rejects the update.
- [ ] Clear error message is presented to the user upon save failure.
- [ ] UI state is guaranteed to reflect actual backend settings.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Eliminates dangerous false-state assumptions in security settings.

**GitHub Issue:** [1426](https://github.com/Ethereal-Future/FuTuRe/issues/1426)
