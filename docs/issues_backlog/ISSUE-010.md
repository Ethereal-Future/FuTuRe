# stellar-contract/lib.rs: Integer division truncation in redeem calculation creates accumulating dust and loss of precision in share payouts

**Domain:** Soroban Smart Contracts  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `amm`, `defi`  
**Issue ID:** ISSUE-010

---

## Background
In `stellar-contract/src/lib.rs`, `redeem` computes payout using integer division (lines 403-407):
```rust
let payout = if total_winning > 0 {
    (winning_shares * total_pool) / total_winning
} else {
    0
};
```
When `winning_shares * total_pool` is not evenly divisible by `total_winning`, the fractional part is truncated towards zero.

## Problem
- When thousands of users redeem shares individually, integer truncation leaves residual token dust trapped inside the contract.
- For small position sizes (e.g. retail users with micro-bets), truncation can represent a non-trivial percentage of their expected return (e.g. 5-10% of small payouts lost to truncation).
- There is no accounting for residual dust, meaning the contract balance slowly diverges from internal market balances over time.

## Proposed Solution
Introduce a fixed-point precision scaling factor (`PRECISION: i128 = 10_000_000` / 7 decimal places matching Stellar stroops). For dust collection, credit any remainder from division to the treasury balance or track `accumulated_dust` on the market so it can be swept to the treasury during market finalization.

## Implementation Steps
1. Calculate remainder using `%` operator: `let remainder = (winning_shares * total_pool) % total_winning;`.
2. Credit `remainder` to `market.lp_fees` or treasury.
3. Add a precision rounding helper for all token math in the contract.
4. Add unit tests validating rounding behavior with prime number share totals and pool balances.

## Acceptance Criteria
- [ ] Division remainders are accounted for and routed to treasury rather than orphaned.
- [ ] No unexplained token surplus or deficit remains in contract storage.
- [ ] Payout calculations maintain accuracy to 7 decimal places (stroops).

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1257](https://github.com/Ethereal-Future/FuTuRe/issues/1257)
