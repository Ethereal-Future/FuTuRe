# services/pathPayment.js: Path payment routing does not compute maximum send slippage (sendMax), exposing senders to unlimited price movement

**Domain:** AMM & Liquidity Pools  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `defi`, `security`  
**Issue ID:** ISSUE-045

---

## Background
In `backend/src/services/pathPayment.js`, path payments are executed using `StellarSDK.Operation.pathPaymentStrictReceive` or `pathPaymentStrictSend`:
```javascript
StellarSDK.Operation.pathPaymentStrictReceive({
  sendAsset,
  sendMax: sendMax.toString(),
  destination,
  destAsset,
  destAmount: amount.toString(),
  path,
})
```
In multiple places in the service and caller routes, `sendMax` is either defaulted to an arbitrarily large number (e.g. `amount * 2` or balance total) or calculated without checking user-specified slippage tolerance.

## Problem
- Path payments route through multiple DEX orderbooks and AMM liquidity pools.
- If market prices shift between quote time and ledger inclusion (or if an MEV bot executes a sandwich attack in the mempool), the transaction will consume up to the full `sendMax` amount.
- Senders can lose up to 100% more than quoted without warning if `sendMax` is not strictly bounded by user-defined slippage tolerance (e.g. 0.5% or 1%).
- There is no parameter validation ensuring `sendMax` is >= minimum required amount and <= maximum acceptable slippage ceiling.

## Proposed Solution
Require an explicit `slippageTolerancePercent` (default: 0.5%, max allowable: 5.0%) on all path payment requests:
1. Calculate `sendMax = quotedSourceAmount * (1 + slippageTolerancePercent / 100)`.
2. Format `sendMax` to 7 decimal places.
3. Reject requests if quoted `sendMax` exceeds sender's available balance.
4. Enforce that `sendMax` is strictly passed to `Operation.pathPaymentStrictReceive`.

## Implementation Steps
1. Add `slippageTolerancePercent` to path payment request validation schema.
2. Calculate `sendMax` with strict slippage ceiling in `backend/src/services/pathPayment.js`.
3. Log quote details, path hops, and slippage buffer in transaction audit log.
4. Add unit tests verifying `sendMax` calculation for various slippage tolerances (0.1%, 0.5%, 1%).

## Acceptance Criteria
- [ ] Senders are protected against price movement beyond their chosen slippage tolerance.
- [ ] Transactions reject gracefully on-chain (`op_underfunded` or `op_over_sendmax`) if market moves unfavorably.
- [ ] MEV sandwich attacks are mitigated by tight slippage bounds.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1292](https://github.com/Ethereal-Future/FuTuRe/issues/1292)
