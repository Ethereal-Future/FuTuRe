# services/pool.js: estimateDepositFees and estimateWithdrawFees use floating point Math.min and division, creating financial rounding errors

**Domain:** AMM & Liquidity Pools  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `amm`, `defi`  
**Issue ID:** ISSUE-047

---

## Background
In `backend/src/services/pool.js`, `estimateDepositFees` and `estimateWithdrawFees` calculate expected pool shares (lines 31-40):
```javascript
const reserveA = parseFloat(pool.reserves[0].amount);
const reserveB = parseFloat(pool.reserves[1].amount);
const totalShares = parseFloat(pool.total_shares);

const depositAmt = Math.min(
  (amountA * totalShares) / reserveA,
  (amountB * totalShares) / reserveB
);
```

## Problem
- JavaScript standard `Number` (IEEE 754 64-bit float) loses precision for numbers with more than 15 significant digits.
- Stellar balances have 7 decimal places (stroops) and liquidity pool reserves often exceed millions of units, requiring 15-20 digits of precision.
- Float math introduces rounding drift (e.g. `0.1 + 0.2 !== 0.3`).
- When estimates calculated with JavaScript floats are compared to actual Stellar core on-chain integer math (which uses 64-bit and 128-bit fixed-point integers), the deposit or withdrawal slips outside the computed tolerance, causing unexpected on-chain transaction aborts.

## Proposed Solution
Use a fixed-point arbitrary precision library (`bignumber.js` or native `BigInt` with stroop scaling) for all AMM pool calculations:
- Convert amounts to integer stroops (`amount * 10_000_000n`).
- Execute constant-product integer math: `(amountA_stroops * totalShares_stroops) / reserveA_stroops`.
- Convert back to decimal strings only at the API formatting boundary.

## Implementation Steps
1. Refactor `estimateDepositFees` and `estimateWithdrawFees` in `pool.js` to use `BigInt` stroop math or `bignumber.js`.
2. Implement fixed-point integer division with floor rounding to match stellar-core CPMM logic.
3. Add precision tests comparing calculations against exact stellar-core results.
4. Verify zero floating point drift for large and micro balance inputs.

## Acceptance Criteria
- [ ] All liquidity pool math uses arbitrary-precision or 128-bit integer stroop arithmetic.
- [ ] IEEE 754 floating point rounding errors are completely eliminated.
- [ ] Calculated estimates match on-chain ledger execution exactly.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1294](https://github.com/Ethereal-Future/FuTuRe/issues/1294)
