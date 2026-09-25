# middleware/idempotency.js: Idempotency keys are not tenant-scoped or user-scoped, allowing cross-user cache collisions and payment data leakage

**Domain:** Authentication & Tokens  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `middleware`, `critical-bug`  
**Issue ID:** ISSUE-076

---

## Background
In `backend/src/middleware/idempotency.js`:
```javascript
const idempotencyKey = req.headers['idempotency-key'];
...
const cacheKey = `idempotency:${idempotencyKey}`;
...
const claimed = await redisBackend.setNX(cacheKey, { bodyHash, status: 'in-progress' }, IN_PROGRESS_TTL);
if (!claimed) {
  const outcome = await waitForResult(cacheKey, bodyHash);
  ...
  return res.status(outcome.response.statusCode).json(outcome.response.response);
}
```

## Problem
- The cache key is constructed purely as `idempotency:${idempotencyKey}` without prefixing the authenticated user's ID or public key (`req.user.id`).
- Security Vulnerabilities:
  1. **IDOR / Data Leakage**: If User A sends a payment with key `pay-123`, and User B submits a payment with the same key `pay-123` and a matching body structure, User B receives User A's payment response data (including transaction hash, internal IDs, and account details)!
  2. **Denial of Service**: An attacker can pre-populate predictable idempotency keys (e.g. UUIDs or sequences) via `setNX`, blocking legitimate users from executing transactions with those keys for 24 hours.
  3. **Tenancy Violation**: In multi-tenant deployments, idempotency keys collide across distinct organizations.

## Proposed Solution
Scope all idempotency cache keys to the authenticated user and route:
```javascript
const userId = req.user?.id || 'anonymous';
const route = req.baseUrl + req.path;
const cacheKey = `idempotency:${userId}:${route}:${idempotencyKey}`;
```
Ensure `idempotencyMiddleware` runs AFTER `requireAuth` so `req.user.id` is guaranteed to be available.

## Implementation Steps
1. Move `idempotencyMiddleware` in route stacks to execute after `requireAuth`.
2. Update `cacheKey` format to include `userId` and endpoint path.
3. Reject unauthenticated requests if an idempotency key is supplied on private endpoints.
4. Add security tests verifying User B using User A's idempotency key cannot access User A's response data.

## Acceptance Criteria
- [ ] Idempotency keys are strictly scoped per authenticated user.
- [ ] Cross-user cache collisions and data leaks are prevented.
- [ ] Security tests verify isolation between users.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1323](https://github.com/Ethereal-Future/FuTuRe/issues/1323)
