# backend/src/services/federation.js: SEP-0002 resolution queries q with local username instead of full federation address

**Domain:** Backend & Stellar Integration  
**Complexity:** Medium  
**Labels:** `bug`, `backend`, `stellar`, `sep-0002`, `interoperability`  
**Issue ID:** ISSUE-250

---

## Background
In `backend/src/services/federation.js`, when `resolveFederationAddress()` gets an address whose domain isn't this platform's (`getFederationDomain()`), it finds the remote `FEDERATION_SERVER` from `https://<domain>/.well-known/stellar.toml` and builds the lookup URL like this:

```js
const url = new URL(federationServer);
url.searchParams.set('q', normalized.split('*')[0]);
url.searchParams.set('type', 'name');
```

## Problem
- [SEP-0002](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0002.md) says that for `type=name`, `q` must be the **full Stellar address** (`bob*stellar.org`), not only the local part.
- For `alice*example.com` the service currently sends `?q=alice&type=name`. Federation servers that follow the spec (including the reference implementation and most anchors) answer with `400`/`404` or "not found".
- The `!result?.account_id` branch then writes a negative result to the cache for 30s and returns `404 Federation address not found`. As a result, **every external federation address is effectively unresolvable**, and users can't send to anchors by federation name.
- The bug is hidden from users because it looks like a real "not found" rather than an error.

## Proposed Solution
Send the full normalized federation address as `q`:

```js
url.searchParams.set('q', normalized);
url.searchParams.set('type', 'name');
```

`URLSearchParams` already percent-encodes `*` as needed, so no manual encoding is required.

## Implementation Steps
1. Change line 130 of `backend/src/services/federation.js` to use `normalized` instead of `normalized.split('*')[0]`.
2. Optionally, validate that the response's `stellar_address` (when present) matches the queried address, case-insensitively, before caching it, so a misbehaving server can't return a record for a different user.
3. Add or extend unit tests that mock `fetch` and assert:
   - the lookup request URL has `q=alice*example.com` (decoded) and `type=name`;
   - a mocked spec-compliant response with `account_id` resolves successfully;
   - local-domain lookups (served from Prisma) are unchanged.
4. Optionally, add an integration check against a known public testnet federation server.

## Acceptance Criteria
- [ ] External federation resolution queries comply with SEP-0002.
- [ ] Lookups against third-party Stellar federation anchors succeed.
- [ ] Unit tests assert the full address is sent in `q`.

## Notes
- **Complexity Rating:** Medium (a one-line code fix; most of the work is test coverage and interop checks).
- **Subsystem Notes:** This only affects the outbound/external path. The platform's own federation endpoint (`GET /api/v1/stellar/federation?address=…`) is unaffected.
- Related file-level fix: [ISSUE-251](./ISSUE-251.md).

**GitHub Issue:** [1564](https://github.com/Ethereal-Future/FuTuRe/issues/1564)
