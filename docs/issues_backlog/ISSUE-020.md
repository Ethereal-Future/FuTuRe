# services/stellar.js: wrapWithFeeBump hardcodes BASE_FEE multiplier without dynamic surge fee adjustment during network congestion

**Domain:** Stellar Blockchain Services  
**Complexity:** Medium  
**Labels:** `enhancement`, `stellar`, `backend`  
**Issue ID:** ISSUE-020

---

## Background
In `backend/src/services/stellar.js`, `wrapWithFeeBump` sponsors transaction fees for low-balance accounts (lines 75-88):
```javascript
export function wrapWithFeeBump(innerTx, feeAccountSecret) {
  const feeKeypair = StellarSDK.Keypair.fromSecret(feeAccountSecret);
  const networkPassphrase = isTestnet() ? StellarSDK.Networks.TESTNET : StellarSDK.Networks.PUBLIC;

  const multiplier = parseInt(process.env.FEE_BUMP_MULTIPLIER ?? '10', 10);
  const feeBumpTx = StellarSDK.TransactionBuilder.buildFeeBumpTransaction(
    feeKeypair,
    StellarSDK.BASE_FEE * multiplier,
    innerTx,
    networkPassphrase,
  );
  feeBumpTx.sign(feeKeypair);
  return feeBumpTx;
}
```

## Problem
- The fee is hardcoded to `StellarSDK.BASE_FEE * multiplier` (default 10 * 100 stroops = 1000 stroops / 0.0001 XLM).
- During periods of Stellar network fee surges (e.g. high volume DEX trading or NFT mints), the ledger base fee can surge to 10,000+ stroops.
- When this occurs, transactions with 1,000 stroops are rejected by Horizon validators with `tx_insufficient_fee` or stranded in the mempool until timeout.
- Conversely, during normal low-traffic conditions, paying a static 10x multiplier wastes platform treasury funds on every sponsored payment.

## Proposed Solution
Integrate with `backend/src/services/feeSurge.js` and `getFeeStats()`. Query Horizon's `/fee-stats` endpoint (or use the cached surge fee from `detectFeeSurge()`) to determine the dynamic fee rate required to enter the next ledger. Set the fee-bump fee to `Math.max(surgeFee, BASE_FEE * multiplier)` capped by a configurable safety ceiling (`MAX_FEE_BUMP_STROOPS`).

## Implementation Steps
1. Import `detectFeeSurge` and `getSevenDayAverageFee` from `./feeSurge.js`.
2. In `wrapWithFeeBump`, query current surge fee recommendations.
3. Compute optimal fee with safety clamp between `MIN_FEE_STROOPS` and `MAX_FEE_STROOPS`.
4. Log dynamic fee decision metrics in structured logger.
5. Add tests simulating high network fee scenarios and asserting fee bump adapts dynamically.

## Acceptance Criteria
- [ ] Fee bump adapts dynamically to Horizon fee surge conditions.
- [ ] Transactions are not dropped due to `tx_insufficient_fee` during network congestion.
- [ ] Max fee ceiling prevents treasury draining in extreme surges.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1267](https://github.com/Ethereal-Future/FuTuRe/issues/1267)
