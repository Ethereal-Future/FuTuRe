# services/stellar.js: withHorizonRetry retries submitTransaction without verifying on-chain ledger commitment, risking duplicate payments

**Domain:** Stellar Blockchain Services  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `backend`, `critical-bug`  
**Issue ID:** ISSUE-017

---

## Background
In `backend/src/services/stellar.js`, `sendPayment` submits transactions wrapped in `withHorizonRetry` (line 404):
```javascript
result = await withHorizonRetry(() => getHorizonServer().submitTransaction(txToSubmit));
```
And `withHorizonRetry` (lines 159-179) executes up to 3 retry attempts on transient network errors:
```javascript
for (let attempt = 0; attempt <= HORIZON_RETRY_BACKOFFS.length; attempt++) {
  try {
    const result = await withHorizonTimeout(fn);
    return result;
  } catch (err) {
    if (!isTransientHorizonError(err) || attempt === HORIZON_RETRY_BACKOFFS.length) {
      throw err;
    }
    const delay = HORIZON_RETRY_BACKOFFS[attempt];
    await new Promise((r) => setTimeout(r, delay));
  }
}
```

## Problem
- `submitTransaction` sends an HTTP POST request to Horizon. If the connection drops or times out after Horizon has forwarded the transaction to `stellar-core` (consensus ledger close), `withHorizonTimeout` rejects with `Horizon request timed out`.
- Because `err.isTimeout` is true, `withHorizonRetry` treats it as transient and calls `fn()` again!
- If the original transaction was committed on-chain, resubmitting it may return `tx_bad_seq` (because the sequence number is now spent), causing `withHorizonRetry` to fail and throw an unhandled error.
- The caller receives an exception and assumes the payment failed, when in reality the payment succeeded on-chain. If the caller retries the entire operation, a double payment occurs!

## Proposed Solution
Before retrying a timed-out `submitTransaction`, extract the transaction hash (`txToSubmit.hash().toString('hex')`) and query `getHorizonServer().transactions().transaction(txHash).call()`. If the transaction exists on-chain, return the confirmed transaction result instead of retrying the submission. Only retry submission if Horizon explicitly confirms the transaction hash was never seen in the mempool or ledger.

## Implementation Steps
1. Refactor `withHorizonRetry` or transaction submission logic to accept the transaction hash.
2. On timeout or network drop during submission, catch error and call `checkTransactionStatus(txHash)`.
3. If transaction is found on Horizon, treat as success and return the ledger confirmation details.
4. If transaction returns 404 Not Found, proceed with backoff retry.
5. Add integration test simulating network timeout where transaction is committed on-chain, asserting successful resolution without duplicate submission.

## Acceptance Criteria
- [ ] Transient HTTP timeouts do not report false-negative failures for committed transactions.
- [ ] Transactions already in the ledger are reconciled via hash lookup.
- [ ] Double-spend and false error alerts are eliminated.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1264](https://github.com/Ethereal-Future/FuTuRe/issues/1264)
