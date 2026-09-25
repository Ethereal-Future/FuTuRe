# services/multiSig.js: Lost update race condition when multiple signers concurrently sign pendingMultiSigTx via optimistic update overwrite

**Domain:** Multi-Sig & Authorization  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `concurrency`, `database`  
**Issue ID:** ISSUE-032

---

## Background
In `backend/src/services/multiSig.js`, `addSignature` reads and updates the pending multi-sig transaction (lines 162-185):
```javascript
const pending = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
...
const transaction = StellarSDK.TransactionBuilder.fromXDR(pending.txXdr, getNetworkPassphrase());
transaction.sign(signerKeypair);

const updatedSignatures = [...signatures, { publicKey: signerPublicKey, signedAt: new Date().toISOString() }];
const updatedXdr = transaction.toXDR();

await prisma.pendingMultiSigTx.update({
  where: { txId },
  data: { txXdr: updatedXdr, signatures: updatedSignatures },
});
```

## Problem
- When two signers (e.g. Alice and Bob) sign the pending transaction at approximately the same time:
  1. Alice reads `pending.txXdr` (containing 0 signatures).
  2. Bob reads `pending.txXdr` (containing 0 signatures).
  3. Alice signs and updates `pendingMultiSigTx`, saving XDR with Alice's signature.
  4. Bob signs his copy (which only has Bob's signature) and writes `pendingMultiSigTx.update(...)`.
- Bob's write completely overwrites Alice's update. Alice's signature is permanently erased from `txXdr` and `signatures` array (classic lost update anomaly).
- When the transaction is submitted, it contains only 1 signature instead of 2, failing on-chain with `tx_bad_auth`.

## Proposed Solution
1. Store signatures in a separate relational table `MultiSigSignature` (`id, txId, signerPublicKey, signature, createdAt`) with a unique constraint on `(txId, signerPublicKey)`.
2. Wrap signature insertion and XDR rebuild in a database transaction with row locking (`SELECT ... FOR UPDATE` on `pendingMultiSigTx`) or optimistic concurrency control via a `version` column.
3. On signature addition, rebuild the composite XDR by merging all accumulated signatures from `MultiSigSignature` onto the base transaction.

## Implementation Steps
1. Add Prisma model `MultiSigSignature` with unique constraint `@@unique([txId, signerPublicKey])`.
2. Refactor `addSignature` to insert into `MultiSigSignature`.
3. Reconstruct transaction envelope by applying all existing signatures to the base unsigned XDR.
4. Use a Prisma interactive transaction with row locking or version checking on `pendingMultiSigTx`.
5. Write a concurrent test executing 3 parallel `addSignature` calls on the same `txId` and assert all 3 signatures are preserved.

## Acceptance Criteria
- [ ] Concurrent signing by multiple signers never drops or overwrites signatures.
- [ ] Duplicate signatures from the same public key are rejected atomically.
- [ ] Composite XDR contains all signatures added across concurrent requests.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1279](https://github.com/Ethereal-Future/FuTuRe/issues/1279)
