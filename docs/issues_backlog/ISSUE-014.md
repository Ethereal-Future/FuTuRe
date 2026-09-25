# stellar-contract/lib.rs: Batch redeem halts on memory exhaustion when iterating over large vectors of market IDs

**Domain:** Soroban Smart Contracts  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `performance`  
**Issue ID:** ISSUE-014

---

## Background
In `stellar-contract/src/lib.rs`, `batch_redeem` iterates over a `Vec<u32>` of market IDs (lines 419-450):
```rust
pub fn batch_redeem(env: Env, redeemer: Address, market_ids: Vec<u32>) -> Result<BatchRedeemResult, Error> {
    redeemer.require_auth();
    let mut successes: Vec<RedeemOutcome> = Vec::new();
    let mut failures: Vec<RedeemFailure> = Vec::new();
...
    for id in market_ids.iter() {
        match Self::redeem(env.clone(), redeemer.clone(), id) { ... }
    }
```

## Problem
- Soroban transactions have strict CPU instruction limits (100M instructions) and memory limits (40MB host memory).
- If a client passes a large list of `market_ids` (e.g. 50+ markets), the loop exceeds Soroban's transaction execution budget, causing the entire transaction to abort with a host out-of-budget error.
- There is no upper limit validation on `market_ids.len()`.

## Proposed Solution
Define a constant `MAX_BATCH_REDEEM_SIZE: u32 = 20`. In `batch_redeem`, enforce `if market_ids.len() > MAX_BATCH_REDEEM_SIZE { return Err(Error::InvalidAmount); }`. Optimize memory allocations by pre-allocating vectors or returning summary counts.

## Implementation Steps
1. Define `const MAX_BATCH_REDEEM_SIZE: u32 = 20;` in `lib.rs`.
2. Assert `market_ids.len() <= MAX_BATCH_REDEEM_SIZE` at entry of `batch_redeem`.
3. Add unit test asserting that exceeding `MAX_BATCH_REDEEM_SIZE` returns an error.
4. Test execution cost remains safely below 50% of Soroban CPU/memory budget.

## Acceptance Criteria
- [ ] Batch redeem enforces an explicit bound on the number of markets processed per call.
- [ ] Host resource limit budget cannot be exceeded by oversized batches.
- [ ] Tests verify budget consumption for max batch size.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1261](https://github.com/Ethereal-Future/FuTuRe/issues/1261)
