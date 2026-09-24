# loadTesting/loadTestRunner.js: Unbounded concurrency in `Promise.all` exhausts OS socket descriptors (`EMFILE`)

**Domain:** Load Testing & Performance  
**Complexity:** Hard  
**Labels:** `bug`, `loadtest`, `concurrency`, `performance`  
**Issue ID:** ISSUE-166

---

## Background
In `backend/src/loadTesting/loadTestRunner.js`:
When configuring high concurrency (e.g. 5,000 virtual users), the runner creates an array of 5,000 promises and launches them simultaneously via `Promise.all()`.

## Problem
- Node.js attempts to open 5,000 TCP sockets simultaneously.
- On Linux and macOS systems with default file descriptor limits (`ulimit -n 1024`), the runner crashes immediately with `Error: connect EMFILE` or `ECONNRESET`.
- Even with higher ulimits, flooding the loopback interface creates TCP SYN queue overflows, skewing latency benchmarks with artificial connection queuing that does not reflect application performance.

## Proposed Solution
1. Implement concurrency pooling with a worker pool, semaphore, or `p-limit`.
2. Support configurable connection pooling with `http.Agent({ keepAlive: true, maxSockets: concurrency })`.
3. Pace request generation according to an open-loop or closed-loop rate schedule (e.g. tokens per second) rather than unconstrained `Promise.all`.

## Implementation Steps
1. Refactor request dispatching in `backend/src/loadTesting/loadTestRunner.js` to use bounded concurrency pools.
2. Configure persistent HTTP Agent with keep-alive and connection reuse.
3. Add benchmark tests confirming stable execution up to 10,000 virtual requests without `EMFILE` errors.

## Acceptance Criteria
- [ ] Load test runner never throws `EMFILE` or `ECONNRESET` under high concurrency.
- [ ] Concurrent worker count strictly respects configured max concurrency limit.
- [ ] Benchmarking measurements reflect accurate server response times rather than client-side socket queuing.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Crucial for reliable performance benchmarking.

**GitHub Issue:** [1413](https://github.com/Ethereal-Future/FuTuRe/issues/1413)
