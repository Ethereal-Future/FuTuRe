# services/multiSig.js: Concurrent submitMultiSigTransaction calls cause duplicate Horizon submissions and ledger race conditions

**Domain:** Multi-Sig & Authorization  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `concurrency`, `backend`  
**Issue ID:** ISSUE-035

---

## Background
In `backend/src/services/multiSig.js`, `submitMultiSigTransaction` checks `if (pending.status !== 'pending')` (line 211), but only updates status to `submitted` or `executed` AFTER Horizon submission completes:
```javascript
result = await withHorizonRetry(() => getHorizonServer().submitTransaction(transaction));
await prisma.pendingMultiSigTx.update({
  where: { txId },
  data: { status: 'executed', hash: result.hash, ... }
});
```

## Problem
- If two signers view the pending transaction and both click "Submit to Network" at the same time:
  1. Both requests read `pending.status === 'pending'`.
  2. Both requests call `submitTransaction` concurrently on Horizon.
  3. One submission succeeds; the second submission gets an error or redundant network processing.
  4. If retry logic kicks in, parallel requests can cause confusion and conflicting event logs.
- There is no atomic status transition prior to submission.

## Proposed Solution
Use an atomic status transition with database lock before initiating submission:
```javascript
const updated = await prisma.pendingMultiSigTx.updateMany({
  where: { txId, status: 'pending' },
  data: { status: 'submitting' }
});
if (updated.count === 0) {
  throw new Error(`Transaction ${txId} is already being submitted or executed`);
}
```
If submission fails permanently, revert status back to `pending` so it can be retried.

## Implementation Steps
1. Add 'submitting' to the multi-sig transaction status enum.
2. Use `updateMany` with `where: { txId, status: 'pending' }` as an atomic compare-and-swap claim.
3. If claim fails, return 409 Conflict indicating submission is already in progress.
4. On submission failure, revert status to 'pending' with error details.
5. Add concurrency test verifying only 1 submission proceeds when triggered concurrently.

## Acceptance Criteria
- [ ] Atomic claim prevents duplicate concurrent Horizon submissions.
- [ ] Simultaneous submit clicks return 409 Conflict for secondary callers.
- [ ] Transaction status accurately reflects in-flight submission state.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1282](https://github.com/Ethereal-Future/FuTuRe/issues/1282)
