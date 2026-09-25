# services/sep31.js: SSRF vulnerability in discoverReceivingAnchor and createCrossBorderTransaction via unvalidated anchor URLs

**Domain:** Stellar Blockchain Services  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`, `backend`  
**Issue ID:** ISSUE-025

---

## Background
In `backend/src/services/sep31.js`:
```javascript
export async function discoverReceivingAnchor(domain) {
  const cleanDomain = normalizeDomain(domain);
  const tomlUrl = `https://${cleanDomain}/.well-known/stellar.toml`;
  const response = await fetchWithTimeout(tomlUrl);
...
}

export async function createCrossBorderTransaction(anchorUrl, params, ...) {
  const cleanAnchorUrl = trimTrailingSlash(anchorUrl);
  const response = await fetchWithTimeout(`${cleanAnchorUrl}/transactions`, ...);
}
```
These functions are directly exposed via `backend/src/routes/stellar/sep31.js` to client requests.

## Problem
- `domain` and `anchorUrl` are unvalidated user inputs.
- An attacker can supply `domain=169.254.169.254` (AWS instance metadata service) or `domain=127.0.0.1:3001` or private VPC IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
- `fetchWithTimeout` will execute an HTTP request from inside the backend VPC to these internal resources, allowing attackers to dump AWS IAM credentials, query internal health ports, or scan private subnets (SSRF).

## Proposed Solution
Validate all domains and URLs using a strict SSRF-safe URL validator (similar to `webhooks/urlValidator.js`):
1. Disallow IP addresses directly in `domain`.
2. Resolve DNS hostname and reject if resolved IP is in private/loopback/link-local ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`).
3. Enforce `https:` scheme only.
4. Pin DNS resolution to prevent DNS rebinding.

## Implementation Steps
1. Import `validateUrl` from `../webhooks/urlValidator.js` or create a centralized `utils/ssrfValidator.js`.
2. In `discoverReceivingAnchor`, validate that `cleanDomain` resolves exclusively to public routable IP addresses.
3. In `createCrossBorderTransaction` and `getTransactionStatus`, validate `anchorUrl` against the SSRF guard before dispatching requests.
4. Add security unit tests attempting to query loopback, metadata, and private IP ranges, asserting 400 rejection.

## Acceptance Criteria
- [ ] Requests to loopback, link-local (169.254.x.x), and RFC1918 private subnets are blocked.
- [ ] Only public HTTPS domains are permitted for SEP-31 anchor discovery.
- [ ] Security tests verify SSRF mitigation.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1272](https://github.com/Ethereal-Future/FuTuRe/issues/1272)
