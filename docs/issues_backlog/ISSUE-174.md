# frontend/utils/validateAmount.ts: JavaScript IEEE 754 floating-point arithmetic causes precision loss on Stellar stroop calculations

**Domain:** Frontend & Stellar  
**Complexity:** Medium  
**Labels:** `bug`, `frontend`, `stellar`, `math`  
**Issue ID:** ISSUE-174

---

## Background
In `frontend/src/utils/validateAmount.ts` (lines 9-16):
```javascript
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) return 'Amount must be a positive number';
  if (num < MIN) return `Minimum amount is ${MIN} XLM`;
  ...
  if (availableBalance !== null) {
    if (num > availableBalance) return 'Amount exceeds available balance';
    if (availableBalance - num - BASE_FEE < MIN_RESERVE)
      return 'Insufficient balance: account must keep a 1 XLM minimum reserve';
  }
```
Floating point numbers (`parseFloat`) are used to evaluate available balance, fees, and reserve.

## Problem
- JavaScript binary floating-point numbers cannot represent exact decimal fractions (e.g. `0.1 + 0.2 = 0.30000000000000004`, `1.0000001 - 0.0000001 = 0.9999999999999999`).
- Stellar represents amounts with 7 decimal digits of precision (1 stroop = 0.0000001 XLM).
- When a user has `2.0000100` XLM and attempts to transfer `1.0` XLM with `0.00001` BASE_FEE, floating point rounding errors can evaluate `2.00001 - 1.0 - 0.00001` as `0.9999999999999999 < 1.0`.
- The user is blocked from submitting a completely valid transaction with a false error: "Insufficient balance: account must keep a 1 XLM minimum reserve"!

## Proposed Solution
1. Migrate amount validation and calculations to `bignumber.js` or integer stroops (`BigInt`):
   - 1 XLM = `10_000_000n` stroops.
   - Convert decimal string to integer stroops without floating point math.
2. Perform reserve subtraction and fee deductions using exact integer arithmetic:
```typescript
const balanceStroops = toStroops(availableBalance);
const transferStroops = toStroops(value);
const feeStroops = toStroops(BASE_FEE);
const minReserveStroops = toStroops(MIN_RESERVE);
if (balanceStroops - transferStroops - feeStroops < minReserveStroops) {
  return 'Insufficient balance: account must keep a 1 XLM minimum reserve';
}
```

## Implementation Steps
1. Implement exact decimal-to-stroop conversion utility in `frontend/src/utils/validateAmount.ts`.
2. Replace all `parseFloat` calculations with `BigInt` or `BigNumber`.
3. Add unit tests covering 7-decimal edge cases (e.g. `0.0000001`, `0.9999999`, exact boundary balances).

## Acceptance Criteria
- [ ] Zero floating-point rounding errors on 7-decimal Stellar amounts.
- [ ] Valid transactions on reserve boundaries are never falsely rejected.
- [ ] Unit tests verify exact precision down to 1 stroop.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Essential financial calculation safety for crypto payments.

**GitHub Issue:** [1421](https://github.com/Ethereal-Future/FuTuRe/issues/1421)
