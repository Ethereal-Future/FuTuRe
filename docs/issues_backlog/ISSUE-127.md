# services/streaming.js: createStream does not verify sender account balance or trustline status for streamed non-native assets prior to activation

**Domain:** Payment Streaming  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `validation`  
**Issue ID:** ISSUE-127

---

## Background
In `backend/src/services/streaming.js`, `createStream` creates the database record and sets `status = 'ACTIVE'` immediately (lines 71-83).
It does not inspect the sender's account on Horizon or check whether the recipient has established a trustline for the asset.

## Problem
- A user can create an active stream for asset `USDC` when:
  1. The sender has 0 USDC balance.
  2. The recipient has no trustline for USDC.
- The stream activates, but the very first worker tick fails on Horizon with `op_no_trust` or `op_underfunded`.
- After 3 ticks, the stream transitions to `FAILED`.
- The user is notified that their stream "failed unexpectedly", when in reality it was never viable from the moment of creation.

## Proposed Solution
Perform pre-flight validation in `createStream`:
1. Load sender account from Horizon: verify sender holds non-native asset and has sufficient balance for at least 1 interval payment.
2. Load recipient account from Horizon: if asset is non-native, verify recipient has an established trustline with sufficient limit to receive the asset.
3. Reject creation with clean validation error if recipient trustline is missing or sender balance is zero.

## Implementation Steps
1. Add pre-flight checks in `createStream` in `services/streaming.js`.
2. Check sender balance >= `rateAmount`.
3. If `assetCode !== 'XLM'`, verify recipient trustline exists on Horizon.
4. Add tests verifying pre-flight rejection when trustline is missing.

## Acceptance Criteria
- [ ] Streams for non-native assets require an active recipient trustline prior to activation.
- [ ] Sender balance is verified before stream creation.
- [ ] Immediate day-one failure of misconfigured streams is prevented.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1374](https://github.com/Ethereal-Future/FuTuRe/issues/1374)
