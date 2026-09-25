# loadTesting/bottleneckAnalyzer.js: Synchronous event-loop delay measurement introduces artificial lag

**Domain:** Load Testing & Profiling  
**Complexity:** Hard  
**Labels:** `bug`, `performance`, `profiling`  
**Issue ID:** ISSUE-169

---

## Background
In `backend/src/loadTesting/bottleneckAnalyzer.js`:
The analyzer samples event-loop lag and CPU usage during load test execution by running tight polling loops and computing timestamp deltas.

## Problem
- Busy-waiting or tight polling loops inside the Node.js main thread directly compete with the application code being benchmarked.
- The profiling tool itself artificially inflates event-loop lag and degrades request processing throughput by up to 25%!
- Results show false bottlenecks in application code that are actually caused by the profiling instrumentation.

## Proposed Solution
1. Use Node.js native `perf_hooks.monitorEventLoopDelay({ resolution: 20 })`.
2. Monitor event loop delay asynchronously without polling or busy-waiting.
3. Sample CPU metrics via non-blocking `process.cpuUsage()` intervals with low frequency (e.g. every 500ms).

## Implementation Steps
1. Replace custom polling loops in `backend/src/loadTesting/bottleneckAnalyzer.js` with `perf_hooks.monitorEventLoopDelay`.
2. Enable and disable event loop monitoring cleanly around test cycles.
3. Measure overhead and verify profiling impact is under 1% of total throughput.

## Acceptance Criteria
- [ ] Instrumentation overhead is less than 1%.
- [ ] Event-loop latency percentiles (p50, p95, p99) are accurately captured using native histogram APIs.
- [ ] CPU usage profiling does not block the Node.js event loop.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Accurate profiling without observer effect.

**GitHub Issue:** [1416](https://github.com/Ethereal-Future/FuTuRe/issues/1416)
