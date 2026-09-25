# services/stellar.js: isTransientHorizonError fails to handle 504 Gateway Timeout and 502 Bad Gateway responses from Horizon reverse proxies

**Domain:** Stellar Blockchain Services  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `backend`, `reliability`  
**Issue ID:** ISSUE-018

---

## Background
In `backend/src/services/stellar.js`, `isTransientHorizonError` defines transient errors eligible for retry (lines 135-149):
```javascript
function isTransientHorizonError(err) {
  const status = err?.response?.status ?? err?.status;
  if (status === 400 || status === 404 || status === 409) return false;
  if (status === 429 || status === 503) return true;
  if (err.isTimeout) return true;
  const code = err?.code;
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET'
  )
    return true;
  return false;
}
```

## Problem
- When connecting to public Horizon instances (e.g. `https://horizon.stellar.org` or a self-hosted Horizon behind Cloudflare/ALB/Nginx), load shedding and upstream restarts produce HTTP 502 Bad Gateway and HTTP 504 Gateway Timeout errors.
- `status === 502` and `status === 504` are neither explicitly listed as true nor covered by `err.isTimeout` (which is only set by internal client-side timeouts).
- Consequently, `isTransientHorizonError` returns `false` for 502 and 504 responses!
- Any momentary proxy glitch instantly aborts transaction submission or account loading without any backoff retry, degrading service reliability.

## Proposed Solution
Update `isTransientHorizonError` to check for `status >= 500 && status < 600` (excluding specific non-transient server codes if any), or explicitly include `status === 502 || status === 504`. Include standard reverse-proxy error codes in the retry criteria.

## Implementation Steps
1. In `backend/src/services/stellar.js`, update `isTransientHorizonError` to include `status === 502 || status === 504` and `status === 520` (Cloudflare).
2. Ensure that any HTTP 5xx error from Horizon triggers exponential backoff retry.
3. Add unit tests for `isTransientHorizonError` verifying that status codes 502, 503, 504, 429 return `true`.
4. Verify that 400, 401, 403, 404 return `false`.

## Acceptance Criteria
- [ ] HTTP 502 and 504 responses from Horizon or upstream reverse proxies are treated as transient and retried.
- [ ] Unit tests cover all relevant HTTP status codes.
- [ ] Retry behavior is verified in integration tests.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1265](https://github.com/Ethereal-Future/FuTuRe/issues/1265)
