# frontend/components/AmountInput.jsx: "Max" button fills raw available balance without deducting fee and minimum reserve

**Domain:** Frontend & UX  
**Complexity:** Medium  
**Labels:** `bug`, `frontend`, `ux`  
**Issue ID:** ISSUE-175

---

## Background
In `frontend/src/components/AmountInput.jsx` (lines 40-42):
```javascript
  const setMax = () => {
    if (availableBalance != null) onChange?.(String(availableBalance));
  };
```
Clicking the "MAX" quick-fill button sets the input value directly to `availableBalance`.

## Problem
- When sending native XLM, the account must pay the transaction base fee (0.00001 XLM) and retain the minimum account reserve (1 XLM + 0.5 XLM per trustline/signer).
- If a user with 50 XLM clicks "MAX", the field is populated with "50".
- Immediate validation rejects the form with "Insufficient balance: account must keep a 1 XLM minimum reserve".
- The user is forced to manually calculate fees and reserves with a calculator, creating a frustrating user experience.

## Proposed Solution
1. Calculate true transferable maximum based on asset type:
   - For non-native assets (e.g. USDC): max is the full available balance.
   - For native XLM: `transferableMax = Math.max(0, balance - minReserve - estimatedFee)`.
2. Populate the input with `transferableMax` when clicking "MAX".
3. Show a tooltip or hint explaining: "Deducted 1 XLM reserve and 0.00001 XLM network fee".

## Implementation Steps
1. Update `setMax` in `frontend/src/components/AmountInput.jsx` to accept `maxTransferable` or calculate reserve deduction.
2. Pass reserve and fee awareness from parent transaction forms.
3. Add tests verifying that clicking MAX produces a valid, submittable amount.

## Acceptance Criteria
- [ ] Clicking "MAX" for XLM fills the exact maximum amount that can be successfully submitted.
- [ ] Form validation does not display "insufficient reserve" errors after clicking MAX.
- [ ] Non-native assets allow sending the complete token balance.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Greatly improves payment submission UX.

**GitHub Issue:** [1422](https://github.com/Ethereal-Future/FuTuRe/issues/1422)
