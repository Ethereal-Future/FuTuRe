# security/oauth2.js: Non-atomic authorization code redemption enables token replay race condition

**Domain:** Security & OAuth2  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `concurrency`, `oauth2`  
**Issue ID:** ISSUE-155

---

## Background
In `backend/src/security/oauth2.js` (lines 53-83):
```javascript
  async exchangeCodeForToken(code, clientId, clientSecret) {
    const authCode = await prisma.oAuth2AuthorizationCode.findUnique({ where: { code } });
    if (!authCode || authCode.expiresAt < new Date()) { ... }
    if (authCode.clientId !== clientId) { ... }
    ...
    // Delete used authorization code
    await prisma.oAuth2AuthorizationCode.delete({ where: { code } });
    // Generate access token...
```
Verification and deletion are executed in separate database calls without transaction isolation.

## Problem
- In a concurrent race condition, two identical token exchange requests containing the same `code` can execute `findUnique` at the same instant.
- Both queries succeed and validate the code before either reaches `delete`.
- Two distinct sets of access tokens and refresh tokens are issued for a single-use authorization code!
- This violates RFC 6749 Section 4.1.2 requiring authorization codes to be strictly single-use.

## Proposed Solution
1. Wrap the authorization code check and deletion in an atomic Prisma transaction with conditional deletion:
```javascript
const deletedCode = await prisma.$transaction(async (tx) => {
  const codeRecord = await tx.oAuth2AuthorizationCode.findUnique({ where: { code } });
  if (!codeRecord || codeRecord.expiresAt < new Date()) return null;
  await tx.oAuth2AuthorizationCode.delete({ where: { code } });
  return codeRecord;
});
if (!deletedCode) throw new Error('Invalid or already used authorization code');
```
2. Or use `deleteMany({ where: { code, expiresAt: { gt: new Date() } } })` and assert `count === 1` before issuing tokens.

## Implementation Steps
1. Refactor `exchangeCodeForToken` in `backend/src/security/oauth2.js` to delete the code atomically in a transaction before token issuance.
2. Add concurrency unit test attempting parallel code exchanges with the same code.
3. Verify only one exchange succeeds and subsequent requests are rejected.

## Acceptance Criteria
- [ ] Authorization codes cannot be redeemed more than once under concurrent requests.
- [ ] Atomic transaction ensures either single redemption succeeds or transaction rolls back.
- [ ] Integration test verifies concurrent replay is blocked.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Prevents replay attacks on authorization codes.

**GitHub Issue:** [1402](https://github.com/Ethereal-Future/FuTuRe/issues/1402)
