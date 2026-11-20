# backend/src/services/federation.js: claimFederationAddress throws raw 500 on duplicate claim and lacks auth

**Domain:** Backend & Security  
**Complexity:** Medium  
**Labels:** `bug`, `security`, `backend`, `auth`, `stellar`  
**Issue ID:** ISSUE-251

---

## Background
`PUT /api/v1/stellar/federation/claim/:publicKey` (`backend/src/routes/stellar/federation.js`) calls `claimFederationAddress({ publicKey, localPart })` in `backend/src/services/federation.js`. The route runs only input validation (`rules.publicKeyParam`, `body('localPart')`), with no authentication middleware.

The service then:

```js
const user = await prisma.user.upsert({ where: { publicKey }, update: {}, create: { publicKey } });
const setting = await prisma.setting.upsert({
  where: { userId: user.id },
  update: { federationAddress },
  create: { userId: user.id, federationAddress },
});
```

`Setting.federationAddress` is declared `String? @unique` in `backend/prisma/schema.prisma`.

## Problem
1. **No authentication or ownership check.** Anyone can call the endpoint with any `:publicKey`:
   - They can **overwrite another user's federation address** (the `update` branch replaces it), which breaks or redirects incoming payments addressed to the old name.
   - They can **create `User` rows for arbitrary public keys** through the `user.upsert`, and claim names on their behalf (name squatting).
2. **Duplicate claims return a raw 500.** If `localPart` is already held by another user, Prisma throws `P2002` (unique constraint failed on `federationAddress`). The service doesn't catch it, and the route returns `error.status || 500` with the Prisma error message, which leaks internal details and gives clients no usable signal.

## Proposed Solution
1. **Require authentication.** Add `requireAuth` (from `backend/src/middleware/auth.js`) to the claim route.
2. **Verify ownership.** Reject with `403 Forbidden` unless the authenticated principal owns `:publicKey` (e.g. `req.user.publicKey === req.params.publicKey`, following the pattern in `routes/contacts.js`).
3. **Stop creating users on claim.** Look up the existing user with `findUnique` and return `404` if they don't exist, instead of `upsert`ing a new `User`.
4. **Map unique-constraint violations to 409.** Catch `P2002` in `claimFederationAddress` and throw an error with `status = 409` and a clear message (`Federation address already claimed`). The existing route error handler will then return it as-is.
   - Optionally, pre-check with `prisma.setting.findFirst({ where: { federationAddress } })` and return 409 when another user owns it. Keep the `P2002` catch anyway, because a pre-check alone is racy.
   - Re-claiming the address the caller already owns should be idempotent (200).

```js
try {
  const setting = await prisma.setting.upsert({ /* ... */ });
  return { federationAddress: setting.federationAddress };
} catch (err) {
  if (err?.code === 'P2002') {
    throw Object.assign(new Error('Federation address already claimed'), { status: 409 });
  }
  throw err;
}
```

5. **Don't leak internals on 500.** In the route's catch block, return a generic message for errors without an explicit `status`.

## Implementation Steps
1. `routes/stellar/federation.js`: import `requireAuth` and add it before `rules.publicKeyParam` on `PUT /claim/:publicKey`; add the ownership check (403).
2. `services/federation.js`: replace `user.upsert` with a lookup, add the `P2002` → 409 mapping, and document the new `@throws` in the JSDoc.
3. Update the frontend/client caller to send the `Authorization: Bearer …` header.
4. Add route tests:
   - no `Authorization` header → `401`;
   - valid token for a different public key → `403`;
   - claiming a name owned by another user → `409`;
   - re-claiming your own current name → `200`;
   - a valid new claim → `200` with `{ federationAddress }`.

## Acceptance Criteria
- [ ] Claiming an already registered address returns HTTP 409 Conflict.
- [ ] Unauthenticated requests to claim federation addresses are rejected with 401.
- [ ] Authenticated users cannot claim or overwrite federation addresses for public keys they don't own (403).
- [ ] Prisma error details are no longer returned to clients.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** This is a security issue. Until it's fixed, any federation address on the platform can be reassigned by an anonymous caller. The public `GET /` resolve and `GET /stellar.toml` routes must stay unauthenticated, as SEP-0001/SEP-0002 require.
- Related file-level fix: [ISSUE-250](./ISSUE-250.md).

**GitHub Issue:** [1565](https://github.com/Ethereal-Future/FuTuRe/issues/1565)
