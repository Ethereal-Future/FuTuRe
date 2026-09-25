# security/oauth2.js: Client secret comparison is vulnerable to timing attacks

**Domain:** Security & Cryptography  
**Complexity:** Medium  
**Labels:** `bug`, `security`, `crypto`  
**Issue ID:** ISSUE-156

---

## Background
In `backend/src/security/oauth2.js` (lines 71-73):
```javascript
    if (!client || client.clientSecret !== clientSecret) {
      throw new Error('Invalid client credentials');
    }
```
Client secrets are compared using JavaScript standard strict inequality (`!==`).

## Problem
- Standard string comparison `!==` short-circuits on the first differing byte.
- An attacker measuring response times over network or local environment can perform character-by-character timing attacks to deduce the client secret.
- Furthermore, client secrets are stored in plaintext in `prisma.oAuth2Client`, risking exposure if read replicas or database dumps leak.

## Proposed Solution
1. Use `crypto.timingSafeEqual` with constant-time byte buffers to compare secrets.
2. Hash client secrets with Argon2id or bcrypt (or scrypt) in the database rather than storing raw plaintext secrets.
3. Verify client secrets by hashing the incoming secret and comparing constant-time against the stored hash.

## Implementation Steps
1. Replace `client.clientSecret !== clientSecret` with constant-time buffer comparison.
2. Hash client secrets on client registration (`registerClient`) using bcrypt/argon2.
3. Update authentication checks to verify incoming secret against hash.

## Acceptance Criteria
- [ ] Client secrets are stored as secure hashes in the database.
- [ ] Secret verification executes in constant time using `crypto.timingSafeEqual`.
- [ ] Timing differences cannot be used to deduce secret characters.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Industry best practice for OAuth2 client authentication.

**GitHub Issue:** [1403](https://github.com/Ethereal-Future/FuTuRe/issues/1403)
