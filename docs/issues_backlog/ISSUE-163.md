# chaos/networkPartitionSimulator.js: Global process monkey-patching corrupts unaffected test suites

**Domain:** Chaos Engineering & Isolation  
**Complexity:** Medium  
**Labels:** `bug`, `testing`, `architecture`  
**Issue ID:** ISSUE-163

---

## Background
In `backend/src/chaos/networkPartitionSimulator.js`:
Network partitions are simulated by intercepting HTTP/gRPC requests globally via monkey-patching `http.request` and `https.request` or global fetch.

## Problem
- Because the monkey-patch is applied globally to the Node.js runtime, it intercepts all outbound network traffic, including:
  - Unrelated background workers (e.g. log forwarders, telemetry, health checks).
  - Parallel test workers running unrelated unit tests.
- This creates severe test pollution, random test failures, and broken monitoring connections during chaos test runs.

## Proposed Solution
1. Restrict network partition simulation to targeted destination hostnames, ports, and request correlation IDs.
2. Require chaos requests to pass a `X-Chaos-Context` header to match partitioned traffic.
3. Provide an isolated HTTP client wrapper or Axios interceptor instead of globally overriding native Node.js networking modules.

## Implementation Steps
1. Refactor `backend/src/chaos/networkPartitionSimulator.js` to use scoped interceptors rather than monkey-patching global `http`.
2. Implement URL and context-header filtering for partition rules.
3. Add teardown hooks to restore native network behavior cleanly.

## Acceptance Criteria
- [ ] Non-targeted network requests (health checks, logging) are never blocked.
- [ ] Chaos rules only affect explicitly targeted hosts or requests with chaos headers.
- [ ] Teardown completely removes all interceptors without side effects.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Improves chaos experiment isolation and prevents collateral test failures.

**GitHub Issue:** [1410](https://github.com/Ethereal-Future/FuTuRe/issues/1410)
