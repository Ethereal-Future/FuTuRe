# recovery/recoveryWorkflow.js: addApproval lacks cryptographic authentication, allowing unauthorized callers to approve recovery requests

**Domain:** Account Recovery & Custody  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `critical-bug`  
**Issue ID:** ISSUE-141

---

## Background
In `backend/src/recovery/recoveryWorkflow.js`:
```javascript
export function addApproval(requestId, contactId) {
  const request = recoveryRequests.get(requestId);
  if (!request) throw new Error('Recovery request not found');
  if (request.status !== 'pending') throw new Error('Recovery request is not active');
  if (!request.approvals.includes(contactId)) {
    request.approvals.push(contactId);
  }
  return request;
}
```
In `backend/src/routes/recovery.js`, `POST /api/recovery/:requestId/approve` simply accepts `{ contactId }` in the request body.

## Problem
- There is ZERO verification that the caller is actually the owner of `contactId`!
- No password, no signed token, no cryptographic signature, and no OTP challenge is verified.
- Any attacker who discovers or guesses a `requestId` and `contactId` can simply send 3 consecutive HTTP POST requests:
  `POST /api/recovery/req-123/approve { "contactId": "contact-1" }`
  `POST /api/recovery/req-123/approve { "contactId": "contact-2" }`
  `POST /api/recovery/req-123/approve { "contactId": "contact-3" }`
- The recovery request is immediately marked approved! The attacker can hijack the victim's account and steal all funds!

## Proposed Solution
Implement secure cryptographic guardian approval verification:
1. When recovery is initiated, generate a unique, cryptographically random 32-byte approval token for each guardian/contact, hashed with SHA-256 before storage in the database.
2. Dispatch the token via an out-of-band channel (encrypted email or SMS link directly to the guardian's verified address).
3. In `addApproval(requestId, approvalToken)`:
   - Verify `crypto.timingSafeEqual(sha256(approvalToken), contact.tokenHash)`.
   - Verify guardian's signature if social recovery uses public keys (guardian signs `(requestId, targetUserId, timestamp)`).
4. Reject any approval without valid cryptographic authorization.

## Implementation Steps
1. Generate cryptographically secure approval tokens for each registered guardian upon recovery initiation.
2. Send approval links with token parameters via secure out-of-band notification channels.
3. Refactor `addApproval` to require and verify the cryptographic approval token or signature.
4. Add security tests verifying that submitting a `contactId` without a valid token is rejected with 401 Unauthorized.

## Acceptance Criteria
- [ ] Guardian approvals require a verified out-of-band cryptographic token or signature.
- [ ] Supplying an unauthenticated `contactId` fails with 401 Unauthorized.
- [ ] Unauthorized account takeovers via spoofed guardian approvals are prevented.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1388](https://github.com/Ethereal-Future/FuTuRe/issues/1388)
