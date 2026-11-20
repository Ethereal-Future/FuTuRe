# backend/src/services/transactionRetry.js: Sequence errors retried without bumping sequence number, causing repeated failures

**Domain:** Backend & Stellar Integration  
**Complexity:** Medium  
**Labels:** `bug`, `backend`, `stellar`, `reliability`  
**Issue ID:** ISSUE-248

---

## Background
In `backend/src/services/transactionRetry.js`, `classifyError()` maps any error whose message contains `sequence` to `SEQUENCE_ERROR`, and `shouldRetry()` treats that category as retryable:

```js
// Retry network, rate limit, and sequence errors
return ['NETWORK', 'RATE_LIMIT', 'SEQUENCE_ERROR', 'UNKNOWN'].includes(errorType);
```

`executeWithRetry(transactionFn, transactionId, options)` then calls the same `transactionFn` again after an exponential backoff delay. The service has no hook to change what `transactionFn` submits between attempts.

## Problem
- A Stellar transaction is signed over its source account sequence number. When Horizon rejects it with `tx_bad_seq`, the account's on-chain sequence has already moved past the value in the envelope.
- Resubmitting the same signed envelope fails with `tx_bad_seq` every time. Waiting longer does not help.
- Each failed attempt increments `circuitBreaker.failures`, which is shared across all transactions in the service instance. A single bad-sequence transaction uses up to `maxRetries + 1` attempts (6 by default) toward the `circuitBreakerThreshold` of 10, so two such transactions can open the breaker and block unrelated healthy transactions for `circuitBreakerTimeout` (60s).
- The time spent in backoff (1s → 2s → 4s → 8s → 16s, plus jitter) is wasted, because the result never changes.

## Proposed Solution
A retry of a sequence error has to resubmit a new transaction, not the old one:

1. Before each sequence-error retry, reload the source account from Horizon (`server.loadAccount(sourcePublicKey)`) to get the current sequence number.
2. Rebuild the transaction with a `TransactionBuilder` using that account, re-sign it, and submit.
3. Make this an explicit part of the service API. Either:
   - accept an `options.rebuild` / `options.onSequenceError` callback that `executeWithRetry` awaits before the next attempt, **or**
   - pass an attempt context into `transactionFn` (e.g. `transactionFn({ attempt, lastErrorType })`) so the caller can rebuild when `lastErrorType === 'SEQUENCE_ERROR'`.
4. If the caller supplied no rebuild path, treat `SEQUENCE_ERROR` as **non-retryable**. Fail fast instead of burning retries on an envelope that cannot succeed.
5. Optionally, don't count sequence-error attempts that are followed by a successful resync toward the shared circuit breaker. They are caller state errors, not signs that Horizon is unhealthy.

## Implementation Steps
1. Extend `executeWithRetry` to accept a rebuild hook (or pass attempt context to `transactionFn`), and document it in the JSDoc.
2. In the catch block, when `classifyError(error) === 'SEQUENCE_ERROR'`:
   - with a rebuild hook: await it, then retry right away (or after a short fixed delay) instead of using the full exponential backoff;
   - without one: emit `transactionFailed` and rethrow.
3. Update callers that submit signed XDR through this service (e.g. `POST /api/retry/transaction` in `backend/src/routes/retry.js`) to provide a rebuild function that reloads the account, rebuilds and re-signs.
4. Add unit tests:
   - a `transactionFn` that throws a `tx_bad_seq` error once, then succeeds after the rebuild hook runs: it resolves, and the rebuild hook was called once;
   - no rebuild hook: a sequence error rejects after one attempt;
   - the circuit breaker stays `CLOSED` after a sequence-error retry that resyncs successfully.

## Acceptance Criteria
- [ ] Sequence error retries successfully refresh the source account sequence.
- [ ] Transactions succeed after sequence resynchronization without opening the circuit breaker.
- [ ] Without a rebuild path, sequence errors fail fast instead of exhausting all retries.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Related to [ISSUE-016](./ISSUE-016.md) (sequence collisions under concurrent submission) and [ISSUE-017](./ISSUE-017.md) (checking on-chain commitment before resubmitting). Before rebuilding, check whether the original transaction hash has already landed on-chain, so a payment is never duplicated.
- Also fixed in the same file: [ISSUE-249](./ISSUE-249.md).

**GitHub Issue:** [1562](https://github.com/Ethereal-Future/FuTuRe/issues/1562)
