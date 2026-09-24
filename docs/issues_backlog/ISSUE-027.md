# services/sep31.js: getTransactionStatus polling mechanism lacks exponential backoff and rate limit coordination with remote anchors

**Domain:** Stellar Blockchain Services  
**Complexity:** Medium  
**Labels:** `enhancement`, `stellar`, `backend`, `performance`  
**Issue ID:** ISSUE-027

---

## Background
In `backend/src/services/sep31.js`, `getTransactionStatus` polls remote anchors via `GET /transactions/:id` (lines 191-227). In production workflows, background workers periodically check transaction status for cross-border payouts.

## Problem
- There is no polling schedule, backoff strategy, or circuit breaker for status queries.
- If multiple transactions are pending against the same anchor, polling workers fire rapid uncoordinated HTTP requests, triggering HTTP 429 Too Many Requests from the receiving anchor's API.
- Anchors that return `pending_external` or `pending_receiver` may take hours or days to settle; fixed-interval aggressive polling wastes bandwidth and risks getting the platform IP blacklisted.

## Proposed Solution
Implement an adaptive polling scheduler for SEP-31 transactions:
- Follow anchor-recommended polling intervals (`eta` or `retry_after` fields in the response).
- Use exponential backoff for long-running states: poll every 15s for the first 2 minutes, every 2 minutes for the next hour, and hourly thereafter.
- Halt polling on terminal states (`completed`, `error`, `expired`).

## Implementation Steps
1. Add polling metadata (`pollCount`, `nextPollAt`, `terminalState`) to `prisma.sep31Transaction` schema.
2. Create a scheduled worker `processSep31StatusPolls()` in `backend/src/scheduler.js`.
3. Calculate `nextPollAt` using adaptive backoff based on transaction age and status.
4. Stop polling when status enters `completed`, `error`, or `rejected`.
5. Add tests verifying polling interval progression.

## Acceptance Criteria
- [ ] Polling frequency decreases adaptively as transaction age increases.
- [ ] Terminal states immediately deactivate polling.
- [ ] Anchor rate limits and 429 responses are avoided.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1274](https://github.com/Ethereal-Future/FuTuRe/issues/1274)
