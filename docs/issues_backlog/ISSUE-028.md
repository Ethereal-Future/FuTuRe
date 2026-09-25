# services/federation.js: Federation lookup lacks DNS caching and circuit breaker protection against downstream domain outages

**Domain:** Stellar Blockchain Services  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `resilience`, `backend`  
**Issue ID:** ISSUE-028

---

## Background
In `backend/src/services/federation.js`, `resolveFederationAddress` resolves Stellar federated addresses (`user*domain.com`) by fetching `https://domain.com/.well-known/stellar.toml` and querying the `FEDERATION_SERVER` endpoint.

## Problem
- Every federation lookup performs fresh DNS resolution and two consecutive external HTTPS network calls without in-memory or Redis caching of the domain's `FEDERATION_SERVER` endpoint.
- If an external anchor or federated domain goes down or experiences latency spikes, requests to the backend `/api/stellar/federation` hang for the full timeout duration (10s), exhausting backend worker threads.
- Rapid user typing in the frontend recipient input triggers multiple duplicate lookups for the same external domain.

## Proposed Solution
1. Cache discovered `FEDERATION_SERVER` URLs per domain in Redis for 24 hours.
2. Protect federation lookups per destination domain using a Circuit Breaker (e.g. `createCircuitBreaker('Federation-' + domain)`). If a domain fails 3 consecutive times, fail fast with a cached offline error for 60 seconds rather than hanging.
3. Cache resolved public keys for identical federation addresses for 5 minutes.

## Implementation Steps
1. Add Redis caching for resolved `stellar.toml` federation server endpoints.
2. Wrap external federation HTTP calls with a dynamic circuit breaker.
3. Add negative caching (short 30s TTL) for non-existent federation addresses to prevent repeated queries.
4. Add tests verifying circuit breaker trip when destination domain is unreachable.

## Acceptance Criteria
- [ ] Repeated federation lookups for the same domain do not re-fetch `stellar.toml`.
- [ ] Unreachable domains fail fast via circuit breaker without exhausting server timeouts.
- [ ] Response latency for federated address resolution drops significantly.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1275](https://github.com/Ethereal-Future/FuTuRe/issues/1275)
