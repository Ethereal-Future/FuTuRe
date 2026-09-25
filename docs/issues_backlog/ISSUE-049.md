# services/offer.js: Passive offer creation does not handle crossing offers against the creator's own active orderbook bids

**Domain:** AMM & Liquidity Pools  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `amm`, `defi`  
**Issue ID:** ISSUE-049

---

## Background
In `backend/src/services/offer.js`, `createPassiveOffer` builds a `manageBuyOffer` or `createPassiveSellOffer` operation on the Stellar DEX. Passive offers do not cross offers at the same price, but will execute against offers at a better price.

## Problem
- If a user or platform account already has an active selling offer on the orderbook at price P, and submits a passive buying offer at price >= P:
  - Stellar core executes self-trade (wash trading), crossing the user's own buy offer against their own sell offer.
  - The user pays double transaction fees, consumes DEX trustline limits, and generates confusing orderbook execution events for their own account.
- The service does not check existing open offers for the source account before placing passive offers.

## Proposed Solution
Before building an offer in `services/offer.js`:
1. Query active open offers for `sourcePublicKey` using `getHorizonServer().offers().forAccount(sourcePublicKey).call()`.
2. Check if any existing open offer has opposing buy/sell assets that would cross with the proposed offer price.
3. If self-trade is detected, warn the user or automatically cancel the opposing offer in the same transaction using `Operation.manageSellOffer({ offerId: existing.id, amount: '0', ... })`.

## Implementation Steps
1. Add `checkSelfTrade(sourcePublicKey, selling, buying, price)` in `offer.js`.
2. Fetch account's open offers and check for crossing price thresholds.
3. If self-trade detected, return a validation warning or append cancellation operations.
4. Add integration test verifying self-trade detection.

## Acceptance Criteria
- [ ] Self-crossing orders are detected prior to submission.
- [ ] Users are prevented from paying unnecessary fees on self-trades.
- [ ] Orderbook liquidity is preserved cleanly.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1296](https://github.com/Ethereal-Future/FuTuRe/issues/1296)
