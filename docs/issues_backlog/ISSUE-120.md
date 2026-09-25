# services/streaming.js: Stream failure threshold discrepancy between docstring (5 retries) and implementation (3 retries) prematurely halts active streams

**Domain:** Payment Streaming  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `documentation`  
**Issue ID:** ISSUE-120

---

## Background
In `backend/src/services/streaming.js`, line 265 docstring documents:
```javascript
/**
 * Worker tick: find all ACTIVE streams whose interval has elapsed and execute the next payment.
 * Streams that fail 5 consecutive times are automatically set to FAILED status.
```
However, the actual code at line 335 enforces:
```javascript
if (updatedStream.failureCount >= 3) {
  await prisma.paymentStream.update({
    where: { id: stream.id },
    data: { status: 'FAILED' },
  });
```

## Problem
- The implementation halts streams after only 3 failures instead of the documented 5.
- Because the worker runs every 10-30 seconds, 3 transient errors (such as Horizon rate-limiting or momentary network partition) take only 30-60 seconds to accumulate.
- Active long-running payment streams (e.g. employee payroll or vendor subscriptions) are abruptly and permanently marked `FAILED` after momentary network hiccups.
- Once marked `FAILED`, the stream stops sending payments permanently, requiring manual intervention to resume.

## Proposed Solution
1. Make the failure threshold configurable via environment variable `STREAM_MAX_CONSECUTIVE_FAILURES` (default 5).
2. Implement exponential backoff between failure retries: instead of retrying on the very next 10-second worker tick, back off failure retries by `intervalSeconds * Math.pow(2, failureCount)` so transient glitches don't burn through retry allowances.
3. Update code and docstrings to match consistently.

## Implementation Steps
1. Add `STREAM_MAX_CONSECUTIVE_FAILURES` in `config/env.js` (default: 5).
2. Update failure check in `streaming.js` to use configured threshold.
3. Add backoff check before retrying failed streams.
4. Update unit tests to assert that stream remains ACTIVE at 3 and 4 failures, and transitions to FAILED only at 5.

## Acceptance Criteria
- [ ] Stream failure threshold aligns with documentation and configuration (5 retries).
- [ ] Backoff prevents rapid failure burning during temporary Horizon downtime.
- [ ] Premature stream halts are prevented.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1367](https://github.com/Ethereal-Future/FuTuRe/issues/1367)
