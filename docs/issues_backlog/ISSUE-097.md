# webhooks/dispatcher.js: Webhook deliveries lack dead-letter queue (DLQ) alerting and automatic endpoint disablement after repeated failures

**Domain:** Webhooks & Delivery  
**Complexity:** Medium  
**Labels:** `enhancement`, `webhooks`, `monitoring`, `resilience`  
**Issue ID:** ISSUE-097

---

## Background
In `backend/src/webhooks/dispatcher.js`, when a delivery exhausts `maxAttempts` (3 attempts), it updates status to `FAILED` (lines 80-82):
```javascript
return prisma.webhookDelivery.update({
  where: { id: delivery.id },
  data: { status: 'FAILED', attempt, lastError: err.message },
});
```

## Problem
- When an endpoint is abandoned or permanently returns HTTP 404/500:
  1. No alert or notification is sent to the account owner informing them that their webhook endpoint is failing.
  2. The system continues queuing new deliveries for every payment and event, creating thousands of doomed rows in `webhookDelivery`.
  3. Continuous failed retries to dead servers waste network bandwidth and database I/O.
- There is no automated circuit breaker to disable webhooks after e.g. 50 consecutive delivery failures.

## Proposed Solution
1. Implement an endpoint circuit breaker: track `consecutiveFailures` on the `Webhook` model.
2. If `consecutiveFailures >= 20`, automatically transition webhook `status` from `ACTIVE` to `DISABLED` and dispatch an email notification to the account owner: "Webhook endpoint disabled due to continuous delivery errors".
3. Provide an admin and user API endpoint `POST /api/webhooks/:id/redeliver` allowing users to redrive failed deliveries after fixing their server.

## Implementation Steps
1. Add `consecutiveFailures: Int` and `status: 'ACTIVE' | 'DISABLED'` to `Webhook` Prisma schema.
2. Increment `consecutiveFailures` on failure; reset to 0 on successful delivery.
3. Disable webhook and send alert when `consecutiveFailures >= 20`.
4. Add redelivery endpoint `POST /api/webhooks/deliveries/:id/redeliver` in `routes/webhooks.js`.
5. Add tests verifying auto-disablement on continuous failures.

## Acceptance Criteria
- [ ] Permanently failing webhook endpoints are automatically disabled.
- [ ] Account owners receive email alerts with endpoint error logs.
- [ ] Users can replay failed deliveries once their server is repaired.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1344](https://github.com/Ethereal-Future/FuTuRe/issues/1344)
