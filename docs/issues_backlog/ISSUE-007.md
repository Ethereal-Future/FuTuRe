# stellar-contract/lib.rs: calc_shares CPMM formula permits zero or negative token inputs, enabling pool draining and share fabrication

**Domain:** Soroban Smart Contracts  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`, `defi`  
**Issue ID:** ISSUE-007

---

## Background
In `stellar-contract/src/lib.rs`, `calc_shares` implements the Constant Product Market Maker (CPMM) pricing formula (lines 671-681):
```rust
fn calc_shares(amount: i128, own_pool: i128, other_pool: i128) -> i128 {
    if own_pool == 0 && other_pool == 0 {
        return amount;
    }
    let denom = own_pool + amount;
    if denom == 0 {
        return 0;
    }
    (amount * (other_pool + own_pool)) / denom
}
```
In `buy_yes`, `buy_no`, and `seed_market`, there is no validation that `amount > 0`.

## Problem
- If a caller passes `amount <= 0` to `buy_yes` or `buy_no`:
  - If `amount` is negative, `denom = own_pool + amount` can become negative or close to zero.
  - If `denom == 0`, it returns 0, but pool balances are updated: `market.yes_pool += amount` decrements the pool balance without transferring funds out!
  - If `amount` is negative and carefully chosen, an attacker can manipulate pool reserves to skew share pricing for subsequent trades.
- If `amount == 0`, state is mutated and events are emitted, polluting off-chain indexers with zero-value transactions.

## Proposed Solution
Add a strict input validation check in all entry points (`buy_yes`, `buy_no`, `seed_market`, `add_liquidity`, `split`, `merge`): `if amount <= 0 { return Err(Error::InvalidAmount); }`. Ensure `denom` in `calc_shares` is strictly positive before division.

## Implementation Steps
1. Add `InvalidAmount = 15` error check at the start of `buy_yes`, `buy_no`, `seed_market`, and `add_liquidity`.
2. In `calc_shares`, assert that `amount > 0`, `own_pool >= 0`, and `other_pool >= 0`.
3. Add test asserting negative amount in `buy_yes` returns `Error::InvalidAmount`.
4. Add test asserting `amount = 0` returns `Error::InvalidAmount`.

## Acceptance Criteria
- [ ] All market transactions reject zero or negative amounts with `Error::InvalidAmount`.
- [ ] Pool reserves cannot be reduced via negative trade inputs.
- [ ] CPMM denominator cannot be manipulated to zero or negative values.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1254](https://github.com/Ethereal-Future/FuTuRe/issues/1254)
