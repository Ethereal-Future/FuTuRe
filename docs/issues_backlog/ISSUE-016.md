# services/stellar.js: Sequence number collision and race condition during concurrent payment submissions for identical source accounts

**Domain:** Stellar Blockchain Services  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `backend`, `concurrency`  
**Issue ID:** ISSUE-016

---

## Background
In `backend/src/services/stellar.js`, `sendPayment` loads the current account sequence from Horizon right before building the transaction (lines 328-343):
```javascript
const sourceAccount = await withHorizonRetry(() =>
  getHorizonServer().loadAccount(sourcePublicKey),
);
const txBuilder = new StellarSDK.TransactionBuilder(sourceAccount, {
  fee: StellarSDK.BASE_FEE,
  networkPassphrase: isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC,
}).addOperation(...);
const transaction = txBuilder.setTimeout(30).build();
```
`TransactionBuilder` increments `sourceAccount.sequence` in memory by 1 for the transaction it builds.

## Problem
- When two payment requests for the same source account arrive within the same second (e.g. rapid user clicks, parallel automated transfers, or background scheduled streams):
  - Request A calls `loadAccount(sourcePublicKey)` and receives sequence `N`.
  - Request B calls `loadAccount(sourcePublicKey)` concurrently and also receives sequence `N`.
  - Both transactions are built and signed with sequence `N + 1`.
  - Request A submits and succeeds; Request B submits to Horizon and immediately fails with `tx_bad_seq` (HTTP 400 Bad Request).
- The user's second payment fails unexpectedly, requiring a manual retry.
- There is no mutex, queue, or in-memory sequence coordinator to serialize transaction creation per source account.

## Proposed Solution
Implement an account sequence manager with concurrency control (e.g. an in-memory lock/queue keyed by `sourcePublicKey` using Redis or an asynchronous mutex). The sequence manager tracks the latest used sequence number in-flight; concurrent builders acquire a lock, increment the tracked sequence number locally without re-querying Horizon if an in-flight transaction is pending, and release the lock once the transaction hash is known.

## Implementation Steps
1. Create a `SequenceManager` class in `backend/src/services/sequenceManager.js` backed by Redis or an in-process keyed lock.
2. In `sendPayment`, wrap account loading and transaction building in `sequenceManager.withLock(sourcePublicKey, async () => { ... })`.
3. If an in-flight sequence number exists, use `new StellarSDK.Account(sourcePublicKey, inFlightSeq)` instead of querying Horizon.
4. Handle sequence synchronization if Horizon rejects with `tx_bad_seq` by clearing local cache and reloading on-chain state.
5. Add a concurrency test simulating 5 simultaneous `sendPayment` calls from the same source account and asserting all 5 succeed with sequential sequence numbers.

## Acceptance Criteria
- [ ] Concurrent payments from the same source account do not fail with `tx_bad_seq`.
- [ ] Each transaction receives a strictly increasing sequence number.
- [ ] All concurrent payments successfully commit to the Stellar ledger.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1263](https://github.com/Ethereal-Future/FuTuRe/issues/1263)
