# frontend/components/LiquidityPoolDepositWithdraw.jsx: Outdated reserve quotes cause transaction reverts on AMM deposit

**Domain:** Frontend & AMM  
**Complexity:** Medium  
**Labels:** `bug`, `frontend`, `amm`, `stellar`  
**Issue ID:** ISSUE-182

---

## Background
In `frontend/src/components/LiquidityPoolDepositWithdraw.jsx`:
When depositing into an automated market maker (AMM) liquidity pool, deposits must match the exact ratio of asset A to asset B reserves in the pool within configured `maxPrice` and `minPrice` bounds.

## Problem
- The UI fetches pool reserves once when opening the dialog.
- On active liquidity pools where other traders execute swaps, reserve ratios fluctuate every ledger (every ~5 seconds).
- When the user clicks "Deposit" after 30 seconds, their deposit ratio violates the pool's updated price bounds.
- Horizon rejects the transaction with `op_cross_bounds` or `op_bad_price`, costing the user transaction fees and causing confusion.

## Proposed Solution
1. Refresh pool reserve quotes every 5 seconds (or stream pool ledger updates via Server-Sent Events).
2. Compute `minPrice` and `maxPrice` with a configurable price tolerance (e.g. 1%).
3. Warn user if the price ratio has moved by more than 0.5% while the modal was open and request re-confirmation.

## Implementation Steps
1. Add auto-refresh polling interval in `LiquidityPoolDepositWithdraw.jsx`.
2. Add price change detection comparing current pool ratio with initial quote.
3. Add unit tests verifying price bound calculation with 1% slippage tolerance.

## Acceptance Criteria
- [ ] Pool reserves automatically refresh while modal is open.
- [ ] Price changes during input trigger a non-disruptive quote update notification.
- [ ] Deposits succeed consistently without `op_cross_bounds` errors.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Ensures reliable AMM liquidity provisioning.

**GitHub Issue:** [1429](https://github.com/Ethereal-Future/FuTuRe/issues/1429)
