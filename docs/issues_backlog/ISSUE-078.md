# middleware/rateLimiter.js: Rate limiting keys depend on spoofable X-Forwarded-For headers without validating trusted reverse proxy hops

**Domain:** Authentication & Tokens  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `rate-limiting`, `middleware`  
**Issue ID:** ISSUE-078

---

## Background
In `backend/src/middleware/rateLimiter.js`, client IP is extracted for rate limiting:
```javascript
const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || req.connection.remoteAddress;
const key = `ratelimit:${clientIp}:${route}`;
```
The Express application in `server.js` does not configure `app.set('trust proxy', ...)` with explicit CIDR ranges.

## Problem
- The `X-Forwarded-For` header can be forged by any client sending a custom HTTP header: `curl -H "X-Forwarded-For: 1.2.3.4" ...`.
- Attackers can rotate the `X-Forwarded-For` header on every request (e.g. randomized fake IPs), completely bypassing rate limiting for brute-force password guessing, credential stuffing, and DoS attacks.
- Conversely, an attacker can spoof a victim's IP address in `X-Forwarded-For` and intentionally trigger rate limits, causing a Denial of Service for innocent users behind corporate NATs or cellular proxies.

## Proposed Solution
1. Configure Express `app.set('trust proxy', 'loopback, linklocal, uniquelocal')` or set explicit trusted proxy hops matching AWS VPC / ALB subnets.
2. Rely on `req.ip` computed securely by Express using trusted proxy traversal from right-to-left.
3. For authenticated users, rate limit primarily by `req.user.id` or `publicKey` rather than IP address.
4. For unauthenticated endpoints, use a composite key combining `req.ip` and User-Agent fingerprint.

## Implementation Steps
1. Configure `app.set('trust proxy', ...)` in `backend/src/server.js` using `TRUSTED_PROXY_CIDR` env var.
2. Refactor `rateLimiter.js` to use `req.ip` instead of reading raw unvalidated `req.headers['x-forwarded-for']`.
3. Prioritize `req.user.id` as the rate limiting key for authenticated endpoints.
4. Add security tests verifying that arbitrary `X-Forwarded-For` headers cannot bypass rate limits.

## Acceptance Criteria
- [ ] Rate limiter cannot be bypassed by spoofing `X-Forwarded-For` headers.
- [ ] Reverse proxy trusted hops are validated according to RFC 7239.
- [ ] Authenticated users are rate-limited by user identity.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1325](https://github.com/Ethereal-Future/FuTuRe/issues/1325)
