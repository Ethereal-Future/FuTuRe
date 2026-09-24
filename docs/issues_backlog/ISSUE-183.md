# frontend/components/DEXOfferManagement.jsx: Cancel order optimistic update gets out of sync with Stellar sequence

**Domain:** Frontend & DEX  
**Complexity:** Medium  
**Labels:** `bug`, `frontend`, `stellar`, `dex`  
**Issue ID:** ISSUE-183

---

## Background
In `frontend/src/components/DEXOfferManagement.jsx`:
Users can manage and cancel active limit orders on the Stellar decentralized exchange (SDEX). Canceling an order submits `manageBuyOffer` or `manageSellOffer` with amount `0` and the order's `offerId`.

## Problem
- When cancelling an offer, the component immediately removes the order from the local table.
- If the cancellation transaction fails on-chain (e.g. sequence number out of order, fee too low, or offer was already filled in the intervening ledger), the UI does not restore the offer.
- The user believes the order was cancelled, while it remains open and active on the DEX, potentially getting filled at an unfavorable price!

## Proposed Solution
1. Mark the cancelling offer with a pending badge (`status: 'cancelling'`) instead of removing it immediately.
2. Await Horizon transaction confirmation.
3. If confirmed, remove from the list. If failed, restore full interactive status and display Horizon error explanation.

## Implementation Steps
1. Update offer cancellation state machine in `DEXOfferManagement.jsx`.
2. Add error rollback handler restoring offer row if submission fails.
3. Add unit test verifying offer remains visible with error badge upon submission failure.

## Acceptance Criteria
- [ ] Offers remain in pending state until on-chain ledger confirmation.
- [ ] Failed cancellations restore offer to active status with descriptive error message.
- [ ] UI state strictly reflects on-chain DEX orderbook reality.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Prevents financial exposure from unrecognized open limit orders.

**GitHub Issue:** [1430](https://github.com/Ethereal-Future/FuTuRe/issues/1430)
