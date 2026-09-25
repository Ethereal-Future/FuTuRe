# recovery/contactManager.js: Trusted recovery contacts lack out-of-band contact verification (SMS/Email OTP challenge) prior to registration

**Domain:** Account Recovery & Custody  
**Complexity:** Medium  
**Labels:** `enhancement`, `security`, `notifications`  
**Issue ID:** ISSUE-144

---

## Background
In `backend/src/recovery/contactManager.js`, users register trusted recovery contacts (guardians) by calling `addContact(userId, { name, email, phone })`.
The contact is immediately saved to the database in active status.

## Problem
- A user can typo an email address or phone number (e.g. `gmai.com` instead of `gmail.com`).
- Worse: an attacker who compromises an account for 30 seconds can add their own email address as a trusted recovery contact without any confirmation from the owner!
- The registered contact never receives a notification or verification challenge confirming that they have agreed to act as a recovery guardian.
- When an account recovery is attempted months later, the contacts fail to respond or turn out to be invalid.

## Proposed Solution
Implement an out-of-band guardian invitation and verification workflow:
1. When a contact is added, mark `status = 'PENDING_VERIFICATION'`.
2. Send an invitation email/SMS to the contact containing a verification link.
3. The guardian must accept the nomination and verify their email/phone before their weight counts toward social recovery.
4. Notify the account owner via their primary security email whenever a new guardian is added or modified.

## Implementation Steps
1. Add `status: 'PENDING' | 'VERIFIED'` and `verificationToken` to `RecoveryContact` in `prisma/schema.prisma`.
2. Send verification invitation via `notifications/channels/email.js`.
3. Expose endpoint `POST /api/recovery/contacts/verify`.
4. Only count `VERIFIED` contacts in social recovery threshold calculations.
5. Add tests verifying unverified contacts cannot approve recovery requests.

## Acceptance Criteria
- [ ] Recovery contacts require explicit out-of-band acceptance before becoming active guardians.
- [ ] Account owners are notified whenever guardian lists are updated.
- [ ] Invalid or unverified contacts cannot participate in account recovery.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1391](https://github.com/Ethereal-Future/FuTuRe/issues/1391)
