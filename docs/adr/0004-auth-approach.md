# ADR-0004: JWT-based Authentication with Refresh Token Rotation

* Status: Accepted
* Deciders: Core engineering team
* Date: 2026-01-20

## Context and Problem Statement

The platform needs to authenticate users making API requests. The authentication mechanism must be stateless enough to work across horizontally-scaled Node.js instances, support MFA (TOTP), integrate with Google OAuth2, and allow tokens to be invalidated (e.g. on logout or suspected compromise) without requiring a central session store.

## Decision Drivers

* Must work across multiple stateless Node.js instances without sticky sessions
* Access tokens must expire quickly to limit the blast radius of token leakage
* Must support refresh without re-login for a smooth UX
* Stolen refresh tokens must be detectable and invalidatable
* Must integrate with Google OAuth2 for social login
* Must support TOTP-based MFA as a second factor

## Considered Options

* **JWT (access + refresh) with refresh token rotation** — short-lived access tokens, rotating refresh tokens stored server-side for revocation
* **Session cookies with server-side store (Redis)** — classic session model, stateful
* **Opaque bearer tokens only** — single long-lived token stored and validated server-side
* **Paseto** — like JWT but with a cleaner algorithm selection API

## Decision Outcome

Chosen option: **JWT access tokens + rotating refresh tokens**, because it is the best fit for stateless horizontal scaling while still allowing revocation via the refresh token store.

Access tokens are short-lived JWTs (default 15 minutes) signed with `JWT_SECRET`. They are validated on every request without a database lookup, keeping hot-path latency low. Refresh tokens are opaque random strings stored in the database. On use, the refresh token is rotated (old token invalidated, new one issued) — any reuse of an old refresh token triggers a family-wide revocation, detecting token theft. Google OAuth2 tokens are exchanged for the same JWT/refresh pair to unify the auth flow.

TOTP secrets are encrypted at rest using `MFA_ENCRYPTION_KEY` (AES-256-GCM) before being written to the database, so a database compromise alone does not expose MFA seeds.

### Positive Consequences

* Stateless access token validation — no per-request DB hit for auth
* Short access token TTL limits damage from leakage
* Refresh token rotation detects replay attacks (if old token reused, all tokens in that family revoked)
* Unified auth path for password and Google OAuth2 users
* MFA secrets are encrypted at rest

### Negative Consequences

* Access tokens cannot be individually revoked before expiry — only refresh tokens can be revoked
* Refresh token rotation requires a DB write on every token refresh (adds latency vs pure JWT)
* `JWT_SECRET` rotation requires all users to re-authenticate (no multi-key support currently)

## Pros and Cons of the Options

### Session Cookies with Redis

* Good, because sessions are trivially revocable — just delete the key
* Good, because no token size concerns (cookie holds only a session ID)
* Bad, because requires Redis as a hard dependency (not optional like in ADR-0003)
* Bad, because sticky sessions or a shared session store are required for horizontal scaling

### Opaque Bearer Tokens Only

* Good, because tokens are meaningless without the server-side store — no JWT parsing attacks
* Good, because revocation is immediate
* Bad, because every request requires a DB lookup — higher latency under load
* Bad, because more complex to implement securely than JWT (need to design token format, storage, etc.)

### Paseto

* Good, because forces use of modern algorithms (no `alg: none` or RS256 foot-guns)
* Good, because library API is simpler than `jsonwebtoken`
* Bad, because significantly smaller ecosystem and community familiarity compared to JWT
* Bad, because at project start, Paseto middleware for Express was less mature
