# auth/userStore.js: User registration lacks email/phone verification challenge before granting active authenticated status

**Domain:** Authentication & Tokens  
**Complexity:** Medium  
**Labels:** `enhancement`, `security`, `backend`  
**Issue ID:** ISSUE-079

---

## Background
In `backend/src/auth/userStore.js` and `routes/auth.js`, `/register` creates a user record and immediately issues active JWT access and refresh tokens without verifying ownership of the provided email address or phone number.

## Problem
- Malicious actors can register accounts using email addresses belonging to third parties or corporate targets.
- The platform sends transaction confirmation emails and compliance alerts to unverified third-party addresses (spam / harassment vector).
- Unverified accounts consume database resources and can be used to hoard usernames or test stolen credit cards / crypto addresses.

## Proposed Solution
Implement an email/SMS verification challenge flow:
1. On registration, create the user with `emailVerified: false` and status `PENDING_VERIFICATION`.
2. Generate a cryptographically secure 6-digit OTP or verification token (TTL 15 mins) and dispatch via `notifications/channels/email.js`.
3. Restrict permissions of unverified users: unverified accounts cannot execute payments or create trustlines.
4. Expose `POST /api/auth/verify-email` accepting the token to promote account status to `ACTIVE`.

## Implementation Steps
1. Add `emailVerified: Boolean` and `verificationToken` fields to `User` model in `prisma/schema.prisma`.
2. Generate verification challenge upon registration in `routes/auth.js`.
3. Add email dispatch for registration verification link/code.
4. Add verification route `POST /api/auth/verify-email`.
5. Add tests verifying unverified accounts cannot initiate payments.

## Acceptance Criteria
- [ ] New accounts require email verification before executing payments.
- [ ] Verification tokens expire after 15 minutes.
- [ ] Third-party email spoofing is prevented.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1326](https://github.com/Ethereal-Future/FuTuRe/issues/1326)
