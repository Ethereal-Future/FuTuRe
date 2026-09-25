# services/multiSig.js: submitMultiSigTransaction fails to verify threshold weight satisfaction before Horizon submission, causing obscure errors

**Domain:** Multi-Sig & Authorization  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `error-handling`  
**Issue ID:** ISSUE-034

---

## Background
In `backend/src/services/multiSig.js`, `submitMultiSigTransaction` loads the transaction from XDR and immediately submits it to Horizon (lines 208-218):
```javascript
export async function submitMultiSigTransaction(txId) {
  const pending = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
...
  const transaction = StellarSDK.TransactionBuilder.fromXDR(pending.txXdr, getNetworkPassphrase());
  let result;
  try {
    result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
```

## Problem
- `submitMultiSigTransaction` never checks whether the accumulated signatures meet the account's required threshold (e.g. `medThreshold` for payments).
- If a user triggers submission with insufficient signer weight (e.g. 1 out of 2 required signatures), the transaction is sent to Horizon.
- Horizon rejects the transaction with `tx_bad_auth` (transaction failed: bad authorization).
- The caller receives an obscure error without knowing which signers signed, what the total accumulated weight is, or how much additional weight is required to authorize the transaction.

## Proposed Solution
Before submitting to Horizon in `submitMultiSigTransaction`:
1. Fetch the source account's current signers and operation thresholds from Horizon (`loadAccount`).
2. Identify which signers have valid signatures on the transaction.
3. Sum the weights of the valid signers: `totalWeight = sum(signer.weight)`.
4. Compare `totalWeight` against the required threshold for the operations in the transaction (`thresholds.med` for payments).
5. If `totalWeight < requiredThreshold`, abort submission early and throw a structured error: `InsufficientSignatures: Required weight ${requiredThreshold}, but accumulated only ${totalWeight}`.

## Implementation Steps
1. Create helper `verifyThresholdsSatisfied(transaction, sourceAccount)`.
2. Map operations to threshold levels (e.g., payment -> medThreshold, setOptions -> highThreshold).
3. Calculate total signature weight from attached signatures against account signer list.
4. In `submitMultiSigTransaction`, call verification before Horizon submission.
5. Return remaining required weight in the error response for client UI display.

## Acceptance Criteria
- [ ] Transactions with insufficient weight are rejected locally before network submission.
- [ ] Error response details current weight vs required threshold.
- [ ] Horizon is not spammed with predictable `tx_bad_auth` failures.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1281](https://github.com/Ethereal-Future/FuTuRe/issues/1281)
