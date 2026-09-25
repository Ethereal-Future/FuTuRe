# mobile/notificationEngine.js: Notification batch dispatch to APNS/FCM does not handle expired device push registration tokens

**Domain:** Mobile & Offline Resilience  
**Complexity:** Medium  
**Labels:** `bug`, `mobile`, `notifications`  
**Issue ID:** ISSUE-137

---

## Background
In `backend/src/mobile/notificationEngine.js`, `broadcastNotification` sends batch push notifications to all registered devices for an account.

## Problem
- When a user uninstalls the mobile app, upgrades their phone, or resets device settings, the Apple/Google push token expires.
- `notificationEngine.js` catches push dispatch errors and logs them, but does not parse the gateway response to prune the dead token from the database.
- Future push broadcasts continue to attempt delivery to thousands of expired tokens, resulting in degraded broadcast throughput and potential IP throttling from Apple and Google push servers.

## Proposed Solution
Parse batch response arrays from FCM and APNS:
1. In Firebase Admin SDK batch responses (`sendEachForMulticast`), inspect `response.responses[i].error`.
2. If error code is `messaging/registration-token-not-registered` or `messaging/invalid-argument`:
   - Collect the expired token strings.
   - Execute `prisma.userDevice.deleteMany({ where: { token: { in: expiredTokens } } })`.
3. Do the same for APNS HTTP/2 error status 410 (`Unregistered`).

## Implementation Steps
1. Update batch send handler in `notificationEngine.js` to inspect per-token delivery results.
2. Collect invalid token strings from FCM and APNS response lists.
3. Prune invalid tokens in a single batch query.
4. Add tests asserting expired tokens are removed from the database.

## Acceptance Criteria
- [ ] Expired device tokens are automatically pruned upon push gateway rejection.
- [ ] Push broadcast latency does not degrade over time.
- [ ] FCM/APNS delivery rates remain optimal.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1384](https://github.com/Ethereal-Future/FuTuRe/issues/1384)
