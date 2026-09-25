# stellar-contract/lib.rs: dispute function accepts arbitrary unbonded disputes without verifying or holding bond collateral

**Domain:** Soroban Smart Contracts  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `security`, `defi`  
**Issue ID:** ISSUE-011

---

## Background
In `stellar-contract/src/lib.rs`, `dispute` takes a caller-specified `bond: i128` parameter (lines 222-241):
```rust
pub fn dispute(
    env: Env,
    disputer: Address,
    market_id: u32,
    bond: i128,
) -> Result<(), Error> {
    disputer.require_auth();
    Self::require_not_paused(&env)?;
    let mut market = Self::load_market(&env, market_id)?;
    Self::require_status(&market, &MarketStatus::Closed)?;
    if market.outcome.is_none() {
        return Err(Error::InvalidOutcome);
    }
    market.status = MarketStatus::Disputed;
    market.disputer = Some(disputer.clone());
    market.dispute_bond = bond;
    Self::save_market(&env, market_id, &market);
```

## Problem
- The `bond` parameter is passed directly by the caller without any minimum threshold check (`MIN_DISPUTE_BOND`).
- Anyone can call `dispute(..., bond: 0)` or `bond: 1` stroop.
- Any attacker can halt a market's settlement for free by submitting a zero-bond dispute, locking winning bettors from redeeming their funds until an admin manually intervenes.
- There is no requirement that the disputer actually deposits or locks the specified bond amount in tokens.

## Proposed Solution
Define a governance/admin-configurable `MIN_DISPUTE_BOND: i128` (or dynamic percentage of total market pool). Enforce `if bond < MIN_DISPUTE_BOND { return Err(Error::InvalidAmount); }`. Require the disputer to transfer the bond in escrow to the contract using `token::Client::transfer` before updating market status to `Disputed`.

## Implementation Steps
1. Define `MIN_DISPUTE_BOND: i128` constant or storage setting.
2. In `dispute()`, require `bond >= MIN_DISPUTE_BOND`.
3. Transfer `bond` tokens from `disputer` to contract.
4. Add tests verifying dispute is rejected if bond is below minimum or if disputer lacks token balance.
5. Test that valid bond transitions market to `Disputed` status.

## Acceptance Criteria
- [ ] Disputes with `bond < MIN_DISPUTE_BOND` fail with `Error::InvalidAmount`.
- [ ] Bond collateral is transferred and held by the contract during dispute review.
- [ ] Free / zero-cost DoS disputes are completely prevented.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1258](https://github.com/Ethereal-Future/FuTuRe/issues/1258)
