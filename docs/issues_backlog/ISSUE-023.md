# services/stellar.js: Account balance cache invalidation in sendPayment does not invalidate destination account cache, causing stale UI balances

**Domain:** Stellar Blockchain Services  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `caching`, `backend`  
**Issue ID:** ISSUE-023

---

## Background
In `backend/src/services/stellar.js`, upon successful payment completion, the cache is invalidated (lines 430-431):
```javascript
await invalidateBalanceCache(sourcePublicKey);
```
However, the destination account's cached balance is never invalidated.

## Problem
- When User A sends payment to User B on the same platform, User A's cache is invalidated and their balance updates immediately.
- User B's balance remains cached in Redis / `balanceCache.js` with TTL (e.g. 60 seconds).
- User B refreshing their dashboard sees their old balance, leading them to believe the payment was not received or failed, prompting unnecessary support tickets or duplicate transfer requests.

## Proposed Solution
Invalidate both sender and receiver balance caches:
```javascript
await Promise.all([
  invalidateBalanceCache(sourcePublicKey),
  invalidateBalanceCache(destination)
]);
```
Additionally, broadcast a WebSocket balance update event to `destination` if the recipient is connected.

## Implementation Steps
1. In `sendPayment`, add `invalidateBalanceCache(destination)` alongside `invalidateBalanceCache(sourcePublicKey)`.
2. Apply the same dual-invalidation in `pathPayment.js` and `multiSig.js`.
3. Trigger a WebSocket push notification to `destination` account channel so connected clients refresh balances in real-time.
4. Add integration test verifying recipient cached balance updates immediately after incoming payment.

## Acceptance Criteria
- [ ] Both source and destination balance caches are cleared upon payment settlement.
- [ ] Connected recipients receive real-time balance invalidation via WebSocket.
- [ ] Stale balance reads following peer-to-peer transfers are eliminated.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1270](https://github.com/Ethereal-Future/FuTuRe/issues/1270)
