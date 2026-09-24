# compliance/amlMonitor.js: holdAccountForReview does not automatically freeze open Stellar trustlines or cancel pending orders on the DEX

**Domain:** Compliance & AML  
**Complexity:** Hard  
**Labels:** `bug`, `compliance`, `stellar`, `security`  
**Issue ID:** ISSUE-091

---

## Background
In `backend/src/compliance/amlMonitor.js`, `holdAccountForReview` updates internal database state (lines 92-119):
```javascript
await prisma.user.update({
  where: { id: userId },
  data: {
    amlStatus: 'HELD_FOR_REVIEW',
    amlHoldReason: reason,
    amlHoldDate: new Date(),
  },
});
```
It logs an audit entry and updates the database record.

## Problem
- The hold is applied only in the PostgreSQL database.
- On the Stellar blockchain, the user's account remains completely unencumbered:
  1. Open DEX orders previously submitted by the user continue to execute in the orderbook, allowing the user to convert assets.
  2. The user can still interact directly with Soroban contracts or external wallets.
  3. If the platform is the issuer of the asset (e.g. custom stablecoin with `setFlags: auth_revocable`), the platform can freeze the trustline on-chain via `setTrustLineFlags(..., { authorized: false })`.
- By only setting a database flag, the system fails to prevent on-chain capital flight during an active money-laundering investigation.

## Proposed Solution
When `holdAccountForReview` is triggered:
1. Check for platform-issued assets held by the account; if the issuing asset has `AUTH_REVOCABLE` enabled, submit an on-chain `setTrustLineFlags` operation setting `authorized: false` to immediately freeze on-chain token movement.
2. Automatically cancel all open DEX offers placed by the source account via `Operation.manageSellOffer({ offerId, amount: '0' })`.
3. Terminate all active payment streams (`cancelStream`) originating from the held account.

## Implementation Steps
1. In `holdAccountForReview`, fetch active user Stellar public keys.
2. Query open DEX offers for the account on Horizon and generate batch cancellation transaction.
3. If platform issues revocable assets, submit `setTrustLineFlags` revoking trustline authorization.
4. Halt active payment streams in `services/streaming.js`.
5. Add integration test verifying DEX offer cancellation and trustline freeze on account hold.

## Acceptance Criteria
- [ ] Placing an account on compliance hold cancels active open DEX orders on-chain.
- [ ] Platform-issued assets are frozen via revocable trustline flags.
- [ ] Active payment streams are halted immediately.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1338](https://github.com/Ethereal-Future/FuTuRe/issues/1338)
