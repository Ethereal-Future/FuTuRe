# stellar-contract/tests: Soroban integration test suite lacks edge case coverage for concurrent disputes, integer overflow, and zero-liquidity scenarios

**Domain:** Soroban Smart Contracts  
**Complexity:** Medium  
**Labels:** `enhancement`, `stellar`, `qa`  
**Issue ID:** ISSUE-015

---

## Background
`stellar-contract/tests/integration_test.rs` contains basic happy-path tests for market creation, betting, and redemption. However, several critical edge cases and failure paths in Soroban execution are completely untested.

## Problem
- No test exists for concurrent disputes or dispute rejection followed by re-dispute.
- No test validates zero-liquidity pool swaps (`calc_shares` behavior when reserves are depleted).
- No test checks maximum `i128` values for potential arithmetic overflow during share multiplication.
- Regressions in smart contract math can pass CI undetected due to shallow integration test assertions.

## Proposed Solution
Expand `stellar-contract/tests/integration_test.rs` with comprehensive boundary test cases: zero-liquidity trade attempts, max integer overflow tests, multiple LPs depositing and withdrawing sequentially with intervening swaps, and dispute state machine permutations.

## Implementation Steps
1. Add test `test_zero_liquidity_swap_rejection`.
2. Add test `test_cpmm_arithmetic_overflow_protection`.
3. Add test `test_sequential_lp_fee_distribution_equality`.
4. Add test `test_full_dispute_lifecycle_uphold_and_reject`.
5. Run `cargo test` in `stellar-contract/` and verify 100% test passing.

## Acceptance Criteria
- [ ] All edge cases (zero liquidity, large numbers, dispute transitions) covered by tests.
- [ ] Integration test suite passes in CI without warnings.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1262](https://github.com/Ethereal-Future/FuTuRe/issues/1262)
