# stellar-contract/lib.rs: remove_liquidity updates lp_pool and total_lp_shares but leaves yes_pool and no_pool unadjusted, breaking pool invariant

**Domain:** Soroban Smart Contracts  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `amm`, `defi`  
**Issue ID:** ISSUE-008

---

## Background
When liquidity is deposited via `add_liquidity` (lines 476-480):
```rust
market.lp_pool += amount;
market.total_lp_shares += lp_shares;
market.yes_pool += amount / 2;
market.no_pool += amount / 2;
```
`lp_pool` increases, and both `yes_pool` and `no_pool` are credited with half the deposit to provide liquidity for YES and NO traders.

However, in `remove_liquidity` (lines 493-528):
```rust
market.lp_pool -= payout;
market.total_lp_shares -= lp_shares;
pos.lp_shares -= lp_shares;
Self::save_market(&env, market_id, &market);
```
Neither `yes_pool` nor `no_pool` is decremented when LP liquidity is withdrawn!

## Problem
- When an LP removes their liquidity, `yes_pool` and `no_pool` remain artificially inflated as if the liquidity was still present.
- In `redeem` (lines 397-405):
  `let total_pool = market.yes_pool + market.no_pool;`
  `let payout = (winning_shares * total_pool) / total_winning;`
- The payout calculation computes total pool size from `yes_pool + no_pool`! Because `yes_pool` and `no_pool` were never decremented when LPs withdrew, `total_pool` is greater than the actual funds held in the contract.
- The last winning share redeemers will find the contract insolvent, as earlier redeemers withdrew inflated payouts based on phantom liquidity.

## Proposed Solution
In `remove_liquidity`, calculate the proportional deduction from `yes_pool` and `no_pool` based on the fraction of LP shares being redeemed: `deduct_yes = (lp_shares * market.yes_pool) / market.total_lp_shares;` and `deduct_no = (lp_shares * market.no_pool) / market.total_lp_shares;`. Decrement `market.yes_pool -= deduct_yes` and `market.no_pool -= deduct_no` before saving the market.

## Implementation Steps
1. In `remove_liquidity`, compute the proportion `share_ratio = lp_shares / market.total_lp_shares`.
2. Deduct proportional amounts from `market.yes_pool` and `market.no_pool`.
3. Ensure pool values cannot underflow below zero.
4. Verify that total contract backing assets equal `market.yes_pool + market.no_pool + market.lp_fees` at all times.
5. Add integration test verifying deposit -> trade -> withdraw -> redeem lifecycle preserves exact token solvency.

## Acceptance Criteria
- [ ] `yes_pool` and `no_pool` correctly decrease when liquidity is removed.
- [ ] `redeem` total pool matches actual remaining contract reserves.
- [ ] Contract cannot become insolvent through LP withdrawal followed by share redemption.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1255](https://github.com/Ethereal-Future/FuTuRe/issues/1255)
