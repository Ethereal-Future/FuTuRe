# services/pathPayment.js: Strict receive path payment fails to recover alternate paths when Horizon returns path_no_path error

**Domain:** AMM & Liquidity Pools  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `resilience`, `backend`  
**Issue ID:** ISSUE-052

---

## Background
In `backend/src/services/pathPayment.js`, `sendPathPayment` queries path options from Horizon, constructs the transaction with the top path, and submits it. If market conditions change between quote time and submission time, Horizon returns `op_underfunded`, `op_over_sendmax`, or `path_no_path`.

## Problem
- When a path fails, `sendPathPayment` simply throws the raw error to the caller.
- Because paths on the DEX fluctuate rapidly, candidate paths 2 and 3 returned during path discovery might still be completely viable.
- The service does not attempt a fallback retry with the next best path or re-query fresh paths, forcing users to manually restart their entire payment flow on transient liquidity shifts.

## Proposed Solution
Implement an automatic fallback mechanism in `sendPathPayment`:
1. Fetch the top 3 paths from Horizon.
2. If the first path fails with `op_over_sendmax` or `path_no_path`, check if the second candidate path is within the user's acceptable slippage tolerance.
3. If viable, re-build and submit with the fallback path.
4. Log fallback path execution details for audit tracking.

## Implementation Steps
1. Store candidate path options in `sendPathPayment` execution context.
2. Catch `path_no_path` and `op_over_sendmax` transaction errors.
3. Attempt submission with secondary path if within allowed slippage tolerance.
4. Add test simulating path failure and verifying successful fallback resolution.

## Acceptance Criteria
- [ ] Transient path failures automatically attempt viable secondary paths.
- [ ] Payments succeed despite momentary orderbook fluctuations.
- [ ] Slippage bounds are strictly respected during fallbacks.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1299](https://github.com/Ethereal-Future/FuTuRe/issues/1299)
