# auth/tokens.js: Refresh tokens lack unique token identifiers (jti) and token family rotation, preventing revocation of stolen tokens

**Domain:** Authentication & Tokens  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `backend`  
**Issue ID:** ISSUE-070

---

## Background
In `backend/src/auth/tokens.js`, `signRefreshToken` encodes only the basic user payload:
```javascript
export function signRefreshToken(payload) {
  return jwt.sign(payload, getSecret(), {
    expiresIn: '7d',
    algorithm: 'HS256',
    issuer: TOKEN_ISSUER,
    audience: REFRESH_TOKEN_AUDIENCE,
  });
}
```
Refresh tokens have a 7-day expiration and are stateless.

## Problem
- There is no `jti` (JWT ID) or database record tracking individual issued refresh tokens.
- If a refresh token is stolen (via XSS, device compromise, or network interception):
  1. An attacker can use the refresh token to continuously mint new access tokens for 7 days.
  2. Even if the legitimate user clicks "Log Out" or "Change Password", the stolen refresh token CANNOT be revoked because the backend only checks the JWT cryptographic signature and expiration!
  3. There is no Token Family Rotation (RFC 6749 / OAuth 2.0 Security Best Current Practice): reusing a refresh token should immediately invalidate the entire token family and lock the session.

## Proposed Solution
Implement Refresh Token Rotation with Token Families (OAuth 2.0 BCP):
1. Embed a cryptographically random `jti` (`crypto.randomUUID()`) and `familyId` in every refresh token.
2. Persist `RefreshToken` in database with `(jti, familyId, userId, isRevoked, expiresAt)`.
3. When `/auth/refresh` is called:
   - Check if `jti` exists and is NOT revoked.
   - Immediately mark the current `jti` as used/revoked.
   - Issue a new refresh token with a new `jti` under the same `familyId`.
   - If a revoked `jti` is presented again (indicating token theft/replay), immediately revoke ALL tokens in that `familyId` and alert the user.

## Implementation Steps
1. Create Prisma model `RefreshToken` with `jti`, `familyId`, `userId`, `isUsed`, `isRevoked`, `expiresAt`.
2. Refactor `signRefreshToken` to generate and persist `jti` and `familyId`.
3. In `/auth/refresh` route, implement rotation and replay attack detection.
4. Add automated cleanup job purging expired refresh token records.
5. Write security tests simulating token replay and verifying family revocation.

## Acceptance Criteria
- [ ] Every refresh token can only be used once (one-time use).
- [ ] Token replay triggers immediate revocation of all associated sessions.
- [ ] Logging out revokes the refresh token immediately.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1317](https://github.com/Ethereal-Future/FuTuRe/issues/1317)
