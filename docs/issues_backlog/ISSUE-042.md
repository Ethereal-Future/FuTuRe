# services/multiSig.js: Master weight zeroing during conversion to multi-sig is not atomic with signer addition, risking bricked accounts

**Domain:** Multi-Sig & Authorization  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`, `architecture`  
**Issue ID:** ISSUE-042

---

## Background
In `backend/src/services/multiSig.js`, `createMultiSigAccount` converts an account by adding operations to a single transaction (lines 35-54):
```javascript
txBuilder.addOperation(
  StellarSDK.Operation.setOptions({
    masterWeight,
    lowThreshold: thresholds.low,
    medThreshold: thresholds.medium,
    highThreshold: thresholds.high,
  })
);

for (const signer of signers) {
  txBuilder.addOperation(
    StellarSDK.Operation.setOptions({
      signer: {
        ed25519PublicKey: signer.publicKey,
        weight: signer.weight,
      },
    })
  );
}
```

## Problem
- The first operation sets `masterWeight` and thresholds.
- If `masterWeight === 0` (revoking the master key) and thresholds are set to e.g. 2, the master key is stripped of signing power within operation 1!
- In Stellar, operations within a transaction are executed sequentially. While Stellar checks transaction-level signatures before executing operations, if the operation order or threshold validation has any flaw, setting `masterWeight = 0` before signers are confirmed can cause irreversible account lockout.
- More critically: if the transaction builder fails mid-operation or if signer parameters are invalid, an account can end up with zero master weight and no registered signers.

## Proposed Solution
Order the operations safely:
1. Add all new signers first (Operation 1..N).
2. Set operation thresholds second.
3. Update `masterWeight` (including zeroing) as the final operation.
Furthermore, enforce that `masterWeight` can only be set to 0 if at least two verified alternative signers are being added in the exact same transaction, and verify all signer public keys are valid ed25519 addresses.

## Implementation Steps
1. Reorder operations: add `setOptions` for each signer first, then threshold update and master weight adjustment.
2. Validate all signer public keys with `isValidStellarAddress`.
3. Assert that if `masterWeight === 0`, `signers.length >= 2` and `totalSignerWeight >= thresholds.high`.
4. Add tests verifying operation ordering in generated transaction XDR.

## Acceptance Criteria
- [ ] Signers are added prior to master key revocation in the transaction operation list.
- [ ] Master weight zeroing is blocked unless sufficient alternative signers are present.
- [ ] Generated XDR is verified against Stellar protocol execution rules.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1289](https://github.com/Ethereal-Future/FuTuRe/issues/1289)
