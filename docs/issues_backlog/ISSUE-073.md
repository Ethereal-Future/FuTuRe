# middleware/auth.js: JWT verification fails open or returns ambiguous error codes when authorization headers contain malformed Bearer schemes

**Domain:** Authentication & Tokens  
**Complexity:** Medium  
**Labels:** `bug`, `security`, `middleware`  
**Issue ID:** ISSUE-073

---

## Background
In `backend/src/middleware/auth.js`, `requireAuth` extracts the token:
```javascript
const authHeader = req.headers['authorization'];
const token = authHeader && authHeader.split(' ')[1];
if (!token) return res.status(401).json({ error: 'Access token required' });
```
It then verifies the token using `verifyToken(token)`.

## Problem
- If the client sends `Authorization: Bearer` (without token) or `Authorization: Bearer null` or `Authorization: Basic ...` or multiple space-separated tokens:
  - `token` can become `'null'`, `'undefined'`, or empty string.
  - In certain edge cases with multiple `Authorization` headers, `req.headers['authorization']` is an array or comma-joined string.
  - In some downstream routes, error handling catches the verification error and logs a warning, but returns 500 Internal Server Error instead of 401 Unauthorized.
- Ambiguous error responses confuse API clients and mask credential expiration.

## Proposed Solution
Implement strict RFC 6750 Bearer token parsing:
1. Ensure `authHeader` is a single string: `if (typeof authHeader !== 'string') return res.status(401)...`.
2. Use strict regex match: `const match = authHeader.match(/^Bearer\s+([A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)$/);`.
3. If pattern does not match, return `401 Unauthorized` with `WWW-Authenticate: Bearer error="invalid_token"`.
4. Distinguish between expired tokens (`TokenExpiredError` -> `code: 'TOKEN_EXPIRED'`) and invalid tokens (`JsonWebTokenError` -> `code: 'INVALID_TOKEN'`) so clients know when to trigger refresh.

## Implementation Steps
1. Update `backend/src/middleware/auth.js` with strict Bearer token regex extraction.
2. Handle `TokenExpiredError` explicitly with `code: 'TOKEN_EXPIRED'`.
3. Handle `JsonWebTokenError` with `code: 'INVALID_TOKEN'`.
4. Add tests verifying malformed headers (empty Bearer, non-string, basic auth) all return 401 with structured codes.

## Acceptance Criteria
- [ ] Authorization headers strictly conform to RFC 6750 format.
- [ ] Expired tokens return explicit `TOKEN_EXPIRED` code to prompt client refresh.
- [ ] Malformed headers return clean 401 Unauthorized.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1320](https://github.com/Ethereal-Future/FuTuRe/issues/1320)
