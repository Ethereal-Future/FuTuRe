# services/sep31.js: Missing SEP-10 Web Authentication integration in SEP-31 cross-border payment client

**Domain:** Stellar Blockchain Services  
**Complexity:** Hard  
**Labels:** `enhancement`, `stellar`, `security`, `backend`  
**Issue ID:** ISSUE-026

---

## Background
`backend/src/services/sep31.js` notes in line 11:
```javascript
* Scope: this module implements the sending-anchor role only (discovery,
* transaction creation, status polling). It does not implement SEP-0012
* (KYC) customer exchange...
```
Furthermore, `createCrossBorderTransaction` accepts an optional `options.authToken` passed from the caller, but the platform provides no automated mechanism to negotiate and obtain a SEP-10 JWT challenge token from the receiving anchor.

## Problem
- Standard Stellar receiving anchors require SEP-10 Web Authentication (`WEB_AUTH_ENDPOINT` in `stellar.toml`) to authorize transaction creation on `/transactions`.
- Without automated SEP-10 authentication (requesting challenge transaction, signing with sending anchor keypair, exchanging for JWT), all real-world SEP-31 payment submissions fail with HTTP 401 Unauthorized.
- The platform cannot interoperate with compliant Stellar anchors like Circle, MoneyGram, or Bitso.

## Proposed Solution
Implement a full SEP-10 authentication client:
1. Discover `WEB_AUTH_ENDPOINT` and `SIGNING_KEY` from anchor's `stellar.toml`.
2. Call `GET ${WEB_AUTH_ENDPOINT}?account=${platformPublicKey}` to retrieve the challenge transaction XDR.
3. Validate challenge transaction structure (server signing key, timebounds, home domain tag).
4. Sign challenge with platform master/sending secret key.
5. POST signed challenge to exchange for a SEP-10 JWT token, and cache the token until expiration.

## Implementation Steps
1. Create `backend/src/services/sep10.js` implementing the SEP-10 authentication challenge handshake.
2. In `services/sep31.js`, automatically invoke `sep10.authenticate(anchorDomain)` if `authToken` is not explicitly provided.
3. Cache SEP-10 JWT tokens in Redis with TTL matching the JWT expiration.
4. Add mock anchor tests verifying challenge signing and JWT token acquisition.

## Acceptance Criteria
- [ ] Automated SEP-10 challenge-response authentication enables handshake with receiving anchors.
- [ ] Challenge transaction validation prevents man-in-the-middle and replay attacks.
- [ ] Authenticated SEP-31 requests succeed without manual token provisioning.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1273](https://github.com/Ethereal-Future/FuTuRe/issues/1273)
