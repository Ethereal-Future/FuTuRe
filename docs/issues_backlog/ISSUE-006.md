# stellar-contract/lib.rs: LP fee accounting in claim_lp_fees suffers from cumulative state corruption and unfair fee dilution

**Domain:** Soroban Smart Contracts  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `amm`, `defi`  
**Issue ID:** ISSUE-006

---

## Background
In `stellar-contract/src/lib.rs`, `claim_lp_fees` computes fee shares as follows (lines 530-551):
```rust
let total_lp = market.total_lp_shares.max(1);
let fee_share = (pos.lp_shares * market.lp_fees) / total_lp;
market.lp_fees -= fee_share;
Self::save_market(&env, market_id, &market);
```
`pos.lp_shares` is never decremented, nor is a `fee_checkpoint` or `last_claimed_fee_index` stored on `Position`.

## Problem
- When LP Provider A claims fees, `market.lp_fees` is decremented by Provider A's share.
- Provider A's position still holds `pos.lp_shares`. If new fees accumulate in the market, Provider A can claim again, but their calculation has no record of past claims.
- Worse: if Provider A and Provider B each hold 50% of the pool with $100 in `lp_fees`:
  - Provider A claims: receives $50 (50% of 100). Remaining `market.lp_fees` is $50.
  - Provider B claims: receives $25 (50% of remaining 50).
  - Provider B was entitled to $50, but was shortchanged 50% because the denominator was `total_lp_shares` while the pool was diminished!
- This causes complete mathematical breakdown of LP rewards.

## Proposed Solution
Implement cumulative fee-per-share accounting (standard Uniswap v2 / MasterChef accumulator). Store `fee_per_share_accumulated: i128` on `Market`. Whenever trading fees are added, increment `fee_per_share_accumulated += (fee * PRECISION) / total_lp_shares`. Store `last_fee_per_share: i128` on `Position`. In `claim_lp_fees`, compute `pending = pos.lp_shares * (market.fee_per_share_accumulated - pos.last_fee_per_share) / PRECISION`, payout `pending`, and update `pos.last_fee_per_share = market.fee_per_share_accumulated`.

## Implementation Steps
1. Add `fee_per_share_accumulated: i128` to `Market` struct.
2. Add `last_fee_per_share: i128` to `Position` struct.
3. In trading functions where fees are charged, update `fee_per_share_accumulated`.
4. Refactor `claim_lp_fees` to compute delta based on `pos.last_fee_per_share`.
5. Update `pos.last_fee_per_share` on `add_liquidity` and `remove_liquidity` to avoid claiming historical fees.
6. Add property tests verifying equal LPs receive identical fee payouts regardless of claim order.

## Acceptance Criteria
- [ ] Two LPs with identical shares claiming in different order receive identical fee payouts.
- [ ] LP cannot re-claim fees on the same accumulated pool value without new trading activity.
- [ ] Zero division or precision loss during fee distribution is prevented.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1253](https://github.com/Ethereal-Future/FuTuRe/issues/1253)
