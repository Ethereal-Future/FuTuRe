# middleware/idempotency.js: Idempotency release on HTTP error permits duplicate submission during transient network timeouts to Horizon

**Domain:** Authentication & Tokens  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `middleware`  
**Issue ID:** ISSUE-077

---

## Background
In `backend/src/middleware/idempotency.js`:
```javascript
res.json = function (data) {
  const statusCode = res.statusCode;
  if (statusCode >= 200 && statusCode < 300) {
    redisBackend.set(cacheKey, { bodyHash, statusCode, response: data }, IDEMPOTENCY_TTL)...
  } else {
    // Release the claim so a retry after a failed attempt isn't stuck behind it
    redisBackend.delete(cacheKey).catch(...);
  }
  return originalJson(data);
};
```

## Problem
- When a payment request is submitted to Stellar, if Horizon experiences a 504 Gateway Timeout or connection reset, the route handler catches the error and returns `500` or `504` to the client.
- Because `statusCode >= 300`, `res.json` executes `redisBackend.delete(cacheKey)`, immediately deleting the idempotency key!
- However, as noted in Issue #17, the transaction might already have reached the Stellar consensus ledger!
- When the client's automated retry logic receives the 504 and immediately retries the payment with the same `Idempotency-Key`, `setNX` succeeds because the previous key was deleted.
- The backend reconstructs a brand-new payment with a new sequence number and submits it to Stellar, resulting in a DUPLICATE PAYMENT!

## Proposed Solution
Do NOT delete the idempotency key on 5xx errors or network timeouts:
1. For 5xx errors where on-chain execution status is ambiguous (timeouts, connection resets), cache the error status with a short TTL (e.g. 60 seconds) or mark the state as `uncertain`.
2. When a retry arrives for an `uncertain` state, perform an on-chain ledger check for matching transactions from the source account before allowing a fresh submission.
3. Only delete the claim for unambiguous client-side 4xx errors (e.g. 400 Bad Request, 422 Invalid Input) where no on-chain transaction could have been generated.

## Implementation Steps
1. Differentiate 4xx client errors from 5xx server/upstream errors in `idempotencyMiddleware`.
2. Only call `redisBackend.delete(cacheKey)` if `statusCode >= 400 && statusCode < 500`.
3. For 5xx errors, persist status 'failed' with error code and do not delete immediately.
4. Add test verifying that a 504 timeout does not permit immediate duplicate submission with the same idempotency key.

## Acceptance Criteria
- [ ] Transient upstream 5xx errors do not delete idempotency claims.
- [ ] Duplicate payments caused by network timeouts during idempotency retries are eliminated.
- [ ] Client 4xx errors remain immediately retryable.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1324](https://github.com/Ethereal-Future/FuTuRe/issues/1324)
