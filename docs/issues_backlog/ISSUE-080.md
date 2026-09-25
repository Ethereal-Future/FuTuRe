# middleware/mfa.js: MFA verification middleware does not invalidate used TOTP tokens within the current time step, permitting replay attacks

**Domain:** Authentication & Tokens  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `cryptography`  
**Issue ID:** ISSUE-080

---

## Background
In `backend/src/middleware/mfa.js` and `security/mfa.js`, TOTP (Time-based One-Time Password) verification uses standard 30-second time steps:
```javascript
const verified = speakeasy.totp.verify({
  secret,
  encoding: 'base32',
  token,
  window: 1,
});
```
The verification function returns `true` or `false` based on whether `token` matches any step in the time window `[t-1, t, t+1]` (90-second total window).

## Problem
- The system does not record used TOTP tokens.
- If an attacker intercepts a valid 6-digit TOTP code in transit (via MitM, shoulder surfing, or network log):
  - The attacker has up to 90 seconds to submit the exact same TOTP code to authenticate their own session or authorize a second fraudulent payment!
  - RFC 6238 explicitly mandates that a TOTP code MUST NOT be accepted more than once within its valid time window (replay protection).
- Without token invalidation, multi-factor authentication is vulnerable to replay attacks.

## Proposed Solution
Record used TOTP codes in Redis with a 90-second TTL:
```javascript
const usedKey = `mfa:used:${userId}:${token}`;
const isUsed = await redis.set(usedKey, '1', 'EX', 90, 'NX');
if (!isUsed) {
  return res.status(401).json({ error: 'MFA token already used' });
}
```
If `set ... NX` fails, the token has already been consumed within the current time window and must be rejected.

## Implementation Steps
1. In `verifyTOTP` in `backend/src/security/mfa.js`, check Redis for used token key.
2. Atomically mark token as used with 90-second expiration via `SETNX`.
3. Reject used tokens immediately with HTTP 401 `MfaCodeAlreadyUsed`.
4. Add security unit test asserting that the same TOTP token submitted twice within 30 seconds is rejected on the second attempt.

## Acceptance Criteria
- [ ] TOTP codes can only be used once (one-time execution guarantee).
- [ ] Replayed codes within the 90-second window are rejected.
- [ ] RFC 6238 replay protection requirement is satisfied.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1327](https://github.com/Ethereal-Future/FuTuRe/issues/1327)
