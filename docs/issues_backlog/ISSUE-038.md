# services/multiSig.js: Threshold configuration allows setting medThreshold or highThreshold above the sum of all signer weights, locking accounts

**Domain:** Multi-Sig & Authorization  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`, `error-handling`  
**Issue ID:** ISSUE-038

---

## Background
In `backend/src/services/multiSig.js`, `createMultiSigAccount` configures thresholds based on client input (lines 28-42):
```javascript
export async function createMultiSigAccount(sourceSecret, signers, thresholds, masterWeight = 1) {
...
  txBuilder.addOperation(
    StellarSDK.Operation.setOptions({
      masterWeight,
      lowThreshold: thresholds.low,
      medThreshold: thresholds.medium,
      highThreshold: thresholds.high,
    })
  );
```

## Problem
- If a user configures `masterWeight = 0` (intending to revoke the master key) and adds 2 signers with weight 1 each (total available weight = 2), but sets `highThreshold = 3`:
  - Stellar will execute the `setOptions` operation successfully.
  - However, the maximum possible signature weight that can ever be assembled is 2.
  - Operations requiring `highThreshold` (such as changing thresholds, adding signers, or updating account options) require weight 3, which is IMPOSSIBLE to achieve.
  - The account is permanently locked out (bricked) forever, and cannot be salvaged or repaired by any signer!

## Proposed Solution
Add mathematical invariant validation before building the transaction:
1. `const totalWeight = (masterWeight || 0) + signers.reduce((sum, s) => sum + s.weight, 0);`
2. Assert `thresholds.low <= totalWeight`, `thresholds.medium <= totalWeight`, and `thresholds.high <= totalWeight`.
3. Assert `thresholds.low <= thresholds.medium && thresholds.medium <= thresholds.high`.
4. Assert `totalWeight > 0`.
Throw a detailed `InvalidThresholdConfiguration` error if any threshold exceeds `totalWeight`.

## Implementation Steps
1. Create `validateThresholdWeights(masterWeight, signers, thresholds)` in `multiSig.js`.
2. Check that all thresholds are <= `totalWeight`.
3. Check that thresholds satisfy monotonic ordering `0 <= low <= medium <= high`.
4. Reject invalid configurations with 400 Bad Request before generating or submitting transactions.
5. Add unit tests for bricked account prevention scenarios.

## Acceptance Criteria
- [ ] Threshold configurations exceeding total combined signer weight are rejected.
- [ ] Accounts cannot be bricked by setting thresholds above attainable signature weights.
- [ ] Monotonic threshold ordering is strictly enforced.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1285](https://github.com/Ethereal-Future/FuTuRe/issues/1285)
