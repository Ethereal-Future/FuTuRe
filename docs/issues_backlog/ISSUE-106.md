# notifications/channels/sms.js: SMS dispatch service lacks E.164 phone number normalization and carrier route failover

**Domain:** Webhooks & Delivery  
**Complexity:** Medium  
**Labels:** `bug`, `notifications`, `resilience`  
**Issue ID:** ISSUE-106

---

## Background
In `backend/src/notifications/channels/sms.js`, SMS messages are dispatched via Twilio or AWS SNS:
```javascript
export async function sendSms(to, message) {
  return twilioClient.messages.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: message,
  });
}
```

## Problem
- The `to` parameter is passed directly as received from client input without E.164 normalization (e.g. users enter `(555) 123-4567` or `0712345678` without country code).
- Twilio rejects non-E.164 phone numbers with HTTP 400 `Invalid 'To' Phone Number`.
- In addition, there is no secondary carrier failover: if Twilio experiences an outage or carrier route filtering blocks an SMS in a specific country (e.g. Philippines or Nigeria), the notification fails completely.
- Users in those regions cannot receive 2FA codes or transaction SMS alerts.

## Proposed Solution
1. Normalize phone numbers using `google-libphonenumber` to strict E.164 format (`+15551234567`) based on the user's country code.
2. Implement carrier route failover: if primary carrier (Twilio) fails with 5xx or carrier filter, automatically failover to secondary provider (AWS SNS / MessageBird).
3. Validate phone numbers during user registration before saving to database.

## Implementation Steps
1. Integrate `google-libphonenumber` for phone validation and E.164 formatting.
2. Add secondary SMS carrier provider in `channels/sms.js` with automated fallback.
3. Update phone input validation in KYC and user profile routes.
4. Add unit tests for international phone formats (+44, +63, +234, +1).

## Acceptance Criteria
- [ ] All phone numbers are validated and formatted to E.164 before SMS dispatch.
- [ ] Carrier failover ensures SMS delivery during primary provider outages.
- [ ] International numbers in remittance destination markets are supported reliably.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1353](https://github.com/Ethereal-Future/FuTuRe/issues/1353)
