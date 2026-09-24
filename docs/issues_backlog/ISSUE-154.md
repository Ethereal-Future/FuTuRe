# security/oauth2.js: Missing RFC 7636 PKCE (Proof Key for Code Exchange) support creates authorization code interception risk

**Domain:** Security & OAuth2  
**Complexity:** Hard  
**Labels:** `enhancement`, `security`, `oauth2`  
**Issue ID:** ISSUE-154

---

## Background
`backend/src/security/oauth2.js` implements OAuth 2.0 authorization code flow with:
- `generateAuthorizationCode(clientId, userId, scope)`
- `exchangeCodeForToken(code, clientId, clientSecret)`
Neither method implements PKCE (`code_challenge`, `code_challenge_method`, `code_verifier`).

## Problem
- OAuth 2.0 without PKCE is vulnerable to authorization code interception attacks on public clients (mobile apps, single-page React frontend).
- OAuth 2.1 and current IETF BCP (Best Current Practice) mandate PKCE for all authorization code grants.
- Malicious apps on a user device or network interception can steal the authorization code from redirects and exchange it for tokens if client secret is absent or shared.

## Proposed Solution
1. Update `generateAuthorizationCode` to accept `codeChallenge` and `codeChallengeMethod` (`S256` required, `plain` rejected).
2. Store `codeChallenge` and `codeChallengeMethod` on `OAuth2AuthorizationCode` model in Prisma.
3. Update `exchangeCodeForToken` to require `codeVerifier` for public clients (or clients configured with PKCE).
4. Verify `BASE64URL(SHA256(codeVerifier)) === codeChallenge` before issuing tokens.

## Implementation Steps
1. Add `codeChallenge` and `codeChallengeMethod` to `OAuth2AuthorizationCode` in `prisma/schema.prisma`.
2. Update `generateAuthorizationCode` in `backend/src/security/oauth2.js` to validate and store PKCE challenge.
3. Update `exchangeCodeForToken` in `backend/src/security/oauth2.js` to verify SHA-256 verifier.
4. Add unit tests for valid S256 verification and rejection of invalid verifiers.

## Acceptance Criteria
- [ ] Authorization requests with PKCE are properly validated and stored.
- [ ] Token exchange succeeds with matching `code_verifier`.
- [ ] Token exchange fails with HTTP 400 if `code_verifier` does not match `code_challenge`.
- [ ] Plain code challenge method is rejected in favor of S256.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Mandatory compliance for modern OAuth2 security.

**GitHub Issue:** [1401](https://github.com/Ethereal-Future/FuTuRe/issues/1401)
