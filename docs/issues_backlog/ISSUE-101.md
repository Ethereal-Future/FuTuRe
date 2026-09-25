# notifications/webPush.js: Multi-line comment syntax error prevents module loading and web push notification dispatch

**Domain:** Webhooks & Delivery  
**Complexity:** Hard  
**Labels:** `bug`, `notifications`, `critical-bug`, `backend`  
**Issue ID:** ISSUE-101

---

## Background
In `backend/src/notifications/webPush.js` (line 45):
```javascript
 * Web Push — stores push subscriptions in Redis, keyed by
 ^
SyntaxError: Unexpected token '*'
```
The file contains an unclosed multi-line comment or a broken comment delimiter (`*` outside of `/* ... */`).

## Problem
- Running `node -c backend/src/notifications/webPush.js` fails with `SyntaxError: Unexpected token '*'`.
- Any service or route importing `webPush.js` (e.g. `services/streaming.js` which imports `getSubscriptionByPublicKey, sendWebPush`) fails to load or crashes on startup.
- Web push notifications cannot be sent to browser clients.

## Proposed Solution
Fix the malformed multi-line comment syntax in `backend/src/notifications/webPush.js` so it adheres to standard JavaScript syntax (`/** ... */`). Verify module compiles cleanly with `node -c`.

## Implementation Steps
1. Open `backend/src/notifications/webPush.js` and wrap lines 40-50 in proper `/* ... */` comment delimiters.
2. Run `node -c backend/src/notifications/webPush.js` to ensure zero syntax errors.
3. Add integration test verifying `sendWebPush` can be imported and executed.
4. Verify all dependent services (`streaming.js`) load cleanly.

## Acceptance Criteria
- [ ] `backend/src/notifications/webPush.js` parses cleanly without syntax errors.
- [ ] Module imports succeed in Node.js 20.
- [ ] Web push subscriptions can be registered and retrieved.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1348](https://github.com/Ethereal-Future/FuTuRe/issues/1348)
