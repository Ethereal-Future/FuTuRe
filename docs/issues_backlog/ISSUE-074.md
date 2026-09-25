# middleware/csrf.js: CSRF protection is omitted on state-changing API routes that accept cookie-based credentials or session tokens

**Domain:** Authentication & Tokens  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `middleware`  
**Issue ID:** ISSUE-074

---

## Background
`backend/src/middleware/csrf.js` provides double-submit cookie CSRF validation.
However, in `backend/src/server.js`, `csrfMiddleware` is selectively mounted only on a few routes or bypassed for requests with `Content-Type: application/json` under the assumption that browsers cannot send cross-origin JSON without preflight.

## Problem
- Browsers CAN send cross-origin requests with credentials if CORS misconfigurations exist or via `<form action="..." method="POST" enctype="text/plain">` which tricks parsers into accepting JSON without triggering a CORS preflight options check (Simple Request exploitation).
- If session tokens or refresh tokens are stored in `httpOnly` cookies (recommended for XSS protection), any state-changing endpoint without explicit CSRF protection is vulnerable to Cross-Site Request Forgery.
- An attacker embedding a hidden form or script on a malicious website can trigger unauthorized payments or settings changes on behalf of an authenticated user.

## Proposed Solution
1. Require custom header validation (`X-Requested-With: XMLHttpRequest` or `X-FuTuRe-Client: web`) on all state-changing endpoints (`POST`, `PUT`, `PATCH`, `DELETE`). Browsers guarantee that custom headers cannot be set cross-origin without CORS preflight approval.
2. Enforce `SameSite=Strict` (or `SameSite=Lax`) on all session cookies.
3. Validate origin headers: verify `req.headers['origin']` or `req.headers['referer']` strictly matches `APP_URL` / allowed origins.

## Implementation Steps
1. Enforce Origin / Referer validation middleware on all state-changing routes.
2. Require `X-Requested-With` or CSRF token header for all mutating API requests.
3. Set `SameSite=Strict, Secure, HttpOnly` on all authentication cookies in `routes/auth.js`.
4. Add security tests verifying cross-origin form POSTs and missing custom headers are rejected with 403 Forbidden.

## Acceptance Criteria
- [ ] State-changing endpoints reject cross-origin requests without valid preflight origin.
- [ ] Custom header enforcement prevents simple-request CSRF exploits.
- [ ] All session cookies are configured with `SameSite=Strict`.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1321](https://github.com/Ethereal-Future/FuTuRe/issues/1321)
