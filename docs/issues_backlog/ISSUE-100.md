# notifications/delivery.js: Push notifications lack exponential retry backoff and token invalidation on BadDeviceToken responses

**Domain:** Webhooks & Delivery  
**Complexity:** Medium  
**Labels:** `bug`, `notifications`, `resilience`  
**Issue ID:** ISSUE-100

---

## Background
In `backend/src/notifications/delivery.js` and `channels/push.js`, push notifications are dispatched to mobile clients (APNS / FCM).
When the push gateway responds with an error, the delivery module logs the error and abandons the notification.

## Problem
- Transient mobile network errors (e.g. APNS gateway 503 or FCM `Unavailable`) are not retried with exponential backoff, causing users to miss critical transaction alerts.
- Permanent token invalidation errors (APNS `BadDeviceToken` / `Unregistered`, FCM `registration-token-not-registered`) are ignored. The invalid device token is retained in the database, causing every future notification to repeat the failed push request.
- Accumulating thousands of invalid device tokens degrades push dispatch performance and risks rate-limiting from Apple/Google push servers.

## Proposed Solution
1. Classify push gateway responses:
   - For transient errors (`Unavailable`, `InternalServerError`, `DeviceMessageRateExceeded`), retry up to 3 times with exponential backoff (1s, 5s, 15s).
   - For permanent errors (`BadDeviceToken`, `Unregistered`, `InvalidRegistration`), immediately delete the stale device token from `UserDevice` or mark it `inactive`.
2. Provide push dispatch metrics (`push_delivered_total`, `push_failed_total`, `tokens_invalidated_total`).

## Implementation Steps
1. Add error classification helper in `backend/src/notifications/channels/push.js`.
2. Implement retry loop for transient push gateway responses.
3. On `BadDeviceToken`, execute `prisma.userDevice.delete({ where: { token } })`.
4. Add metrics to Prometheus monitoring.
5. Add tests verifying retry on 503 and token deletion on 410 Unregistered.

## Acceptance Criteria
- [ ] Transient push failures are retried automatically.
- [ ] Invalid device tokens are pruned from the database immediately upon rejection.
- [ ] Push deliverability rates improve.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1347](https://github.com/Ethereal-Future/FuTuRe/issues/1347)
