# stellar-contract/lib.rs: Missing reentrancy guards and failure to adhere to Checks-Effects-Interactions (CEI) during external contract callbacks

**Domain:** Soroban Smart Contracts  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`, `cryptography`  
**Issue ID:** ISSUE-009

---

## Background
In Soroban smart contracts, interactions with token contracts (`token::Client`) or external oracles involve cross-contract invocations. If a target token contract is a custom smart contract or executes a callback (e.g. transfer hooks), execution transfers control to an external contract.

In `stellar-contract/src/lib.rs`, when token transfers are introduced for `redeem`, `remove_liquidity`, and `batch_redeem`:
```rust
pub fn redeem(env: Env, redeemer: Address, market_id: u32) -> Result<i128, Error> {
...
    let payout = if total_winning > 0 { (winning_shares * total_pool) / total_winning } else { 0 };
    // Clear position
    if market.outcome == Some(true) { pos.yes_shares = 0; } else { pos.no_shares = 0; }
    Self::save_position(&env, market_id, &redeemer, &pos);
    Self::emit(&env, symbol_short!("redeemed"), (market_id, redeemer, payout));
    Ok(payout)
}
```

## Problem
- If external token transfers are placed before state updates or if an external callback occurs during batch operations, a re-entrant call back into `redeem` or `batch_redeem` could be executed while `pos.yes_shares` is still non-zero.
- In `batch_redeem` (lines 419-450), a loop calls `Self::redeem` for multiple market IDs. If one market triggers a contract trap or re-entry, partial execution leaves state in an inconsistent mid-batch state.
- Lack of an explicit reentrancy lock or strict CEI pattern exposes the contract to drain attacks.

## Proposed Solution
Apply the strict Checks-Effects-Interactions (CEI) pattern across all functions: update storage first (`save_position`, `save_market`) before executing any cross-contract token transfer. Additionally, implement an instance-storage transient reentrancy guard (`REENTRANCY_GUARD`) that is set at the start of state-mutating functions and cleared on return.

## Implementation Steps
1. Create internal helper functions `enter_reentrancy_guard(&env)` and `exit_reentrancy_guard(&env)` using instance storage.
2. Wrap `redeem`, `batch_redeem`, `add_liquidity`, and `remove_liquidity` with the reentrancy guard.
3. Verify all position and market state mutations occur before external token transfer calls.
4. Write an adversarial test contract simulating reentrancy callback during token transfer and assert rejection.

## Acceptance Criteria
- [ ] All state updates are committed to storage prior to external contract invocations.
- [ ] Reentrant calls to the contract within the same invocation frame fail with `Unauthorized` or `ReentrancyError`.
- [ ] Adversarial mock test confirms reentrancy prevention.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1256](https://github.com/Ethereal-Future/FuTuRe/issues/1256)
