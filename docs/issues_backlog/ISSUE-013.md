# stellar-contract/lib.rs: Split and merge functions allow unbounded position creation without corresponding collateral backing

**Domain:** Soroban Smart Contracts  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `defi`  
**Issue ID:** ISSUE-013

---

## Background
In `stellar-contract/src/lib.rs`, `split` and `merge` allow minting and burning complete share sets (lines 555-594):
```rust
pub fn split(env: Env, caller: Address, market_id: u32, amount: i128) -> Result<(), Error> {
    caller.require_auth();
    Self::require_not_paused(&env)?;
    let market = Self::load_market(&env, market_id)?;
    Self::require_status(&market, &MarketStatus::Open)?;
    let mut pos = Self::load_position(&env, market_id, &caller);
    pos.yes_shares += amount;
    pos.no_shares += amount;
    pos.split_tokens += amount;
    Self::save_position(&env, market_id, &caller, &pos);
    Self::emit(&env, symbol_short!("split"), (market_id, caller, amount));
    Ok(())
}
```

## Problem
- When `split` is called, `pos.yes_shares` and `pos.no_shares` are both incremented by `amount`.
- A complete set of YES + NO shares guarantees a payout of 1 unit of token regardless of outcome (since exactly one outcome will win).
- However, `split` does not transfer any collateral tokens from `caller` into the contract!
- A user can call `split(..., amount: 10_000_000)` with zero collateral, obtain 10M YES shares and 10M NO shares, sell the YES shares into the pool via `buy_no` counterpart or hold until resolution, and redeem the winning side for real funds!
- This is a catastrophic infinite money exploit.

## Proposed Solution
Require `split` to transfer `amount` of collateral tokens from `caller` into the contract escrow before minting YES and NO shares. When `merge` is called, burn equal amounts of YES and NO shares and transfer `amount` of collateral tokens back to `caller`.

## Implementation Steps
1. In `split`, validate `amount > 0` and transfer `amount` tokens from `caller` to contract.
2. In `merge`, validate `amount > 0`, verify `pos.yes_shares >= amount && pos.no_shares >= amount`, burn shares, and transfer `amount` tokens back to `caller`.
3. Update `market.lp_pool` or escrow tracking so total contract balance remains 100% reserved.
4. Add integration test verifying collateral transfer on split and refund on merge.

## Acceptance Criteria
- [ ] Splitting requires transferring 1:1 collateral tokens into the contract.
- [ ] Merging burns YES and NO shares and returns 1:1 collateral tokens.
- [ ] Uncollateralized share minting is impossible.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1260](https://github.com/Ethereal-Future/FuTuRe/issues/1260)
