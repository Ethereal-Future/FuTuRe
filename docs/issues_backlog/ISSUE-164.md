# chaos/failureInjector.js: Missing context propagation causes failure injection to leak into production traffic

**Domain:** Chaos Engineering & Safety  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `resilience`  
**Issue ID:** ISSUE-164

---

## Background
In `backend/src/chaos/failureInjector.js`:
The failure injector middleware evaluates whether to inject artificial latency or HTTP 500 errors based on probability thresholds (e.g. `Math.random() < failureRate`).

## Problem
- If chaos middleware is accidentally enabled or misconfigured in staging/production, it randomly fails real user traffic.
- There is no requirement for incoming requests to carry explicit canary headers (`X-Canary-Test: true`) or synthetic user tokens.
- Legitimate users and real payment streams can suffer artificial failures, potential financial discrepancies, or failed blockchain submissions.

## Proposed Solution
1. Require explicit opt-in headers (e.g. `X-Chaos-Experiment-ID`, signed canary token) for all failure injections.
2. If the request does not carry valid canary authentication, bypass failure injection completely regardless of probability settings.
3. Disallow failure injection on critical endpoints (e.g. `/api/transactions/submit`, `/api/recovery/execute`).

## Implementation Steps
1. Add strict header and token validation in `backend/src/chaos/failureInjector.js`.
2. Add an immutable blocklist of protected endpoints that can never receive failure injection.
3. Add automated test verifying requests without canary headers are never disrupted.

## Acceptance Criteria
- [ ] Failure injection strictly requires signed synthetic test headers.
- [ ] Real user transactions are immune to accidental chaos injection.
- [ ] Protected routes reject failure injection unconditionally.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Prevents catastrophic disruption of production traffic.

**GitHub Issue:** [1411](https://github.com/Ethereal-Future/FuTuRe/issues/1411)
