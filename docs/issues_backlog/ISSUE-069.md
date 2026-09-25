# auth/tokens.js: Access tokens and refresh tokens share the identical symmetric JWT secret without separate rotation lifecycles

**Domain:** Authentication & Tokens  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `backend`, `cryptography`  
**Issue ID:** ISSUE-069

---

## Background
In `backend/src/auth/tokens.js`, both access tokens and refresh tokens are signed using the same symmetric secret (lines 8-32):
```javascript
function getSecret() {
  const secret = getConfig()?.security?.jwtSecret;
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
}

export function signAccessToken(payload) {
  return jwt.sign(payload, getSecret(), {
    expiresIn: '15m',
    algorithm: 'HS256',
    issuer: TOKEN_ISSUER,
    audience: ACCESS_TOKEN_AUDIENCE,
  });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, getSecret(), {
    expiresIn: '7d',
    algorithm: 'HS256',
    issuer: TOKEN_ISSUER,
    audience: REFRESH_TOKEN_AUDIENCE,
  });
}
```

## Problem
- Because access tokens (15m) and refresh tokens (7d) share the exact same symmetric signing key:
  1. Any compromise or exposure of the secret signing key allows attackers to forge both short-lived access tokens and long-lived refresh tokens.
  2. If the access token secret must be rotated following an incident, rotating `JWT_SECRET` immediately invalidates ALL refresh tokens, abruptly logging out every active mobile and web user across the entire platform.
  3. Microservices or downstream verifying proxies needing to verify access tokens require access to the master `JWT_SECRET`, exposing the power to forge long-lived refresh tokens.

## Proposed Solution
1. Segregate keys: introduce distinct `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (or better, migrate access tokens to asymmetric RS256/EdDSA signing where public keys verify access tokens while private keys remain on the auth service).
2. Allow independent rotation of access token signing keys without invalidating active refresh sessions.
3. Update `config/env.js` and `infra/secrets.tf` to provision separate secrets for access and refresh tokens.

## Implementation Steps
1. Add `jwtAccessSecret` and `jwtRefreshSecret` to `config/env.js`.
2. Update `signAccessToken` and `verifyToken` to use `jwtAccessSecret`.
3. Update `signRefreshToken` and `verifyRefreshToken` to use `jwtRefreshSecret`.
4. Update `infra/secrets.tf` and ECS task definition to supply both secrets independently.
5. Add tests verifying that access tokens cannot be verified with the refresh secret and vice-versa.

## Acceptance Criteria
- [ ] Access and refresh tokens use separate cryptographic secrets.
- [ ] Rotating access token key does not invalidate active refresh tokens.
- [ ] Cross-token audience/secret substitution attacks are completely prevented.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1316](https://github.com/Ethereal-Future/FuTuRe/issues/1316)
