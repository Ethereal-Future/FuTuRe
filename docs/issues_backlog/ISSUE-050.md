# services/amm.js: Arbitrage calculation does not account for Horizon base fees and pool deposit/withdrawal minimum fees in net profit evaluation

**Domain:** AMM & Liquidity Pools  
**Complexity:** Medium  
**Labels:** `bug`, `amm`, `stellar`, `defi`  
**Issue ID:** ISSUE-050

---

## Background
In `backend/src/services/amm.js`, `calculateArbitrage` scans for price differences between the AMM pool and orderbook (lines 200-240). It computes potential profit as:
```javascript
const profit = expectedOutput - inputAmount;
```
If `profit > 0`, it flags the arbitrage opportunity as profitable.

## Problem
- Executing an arbitrage trade requires 2-3 distinct on-chain operations (e.g. path payment or swap + manage offer), consuming at least 200-500 stroops in base fees, plus pool swap fees (30 bps / 0.3%).
- For small arbitrage spreads (e.g. $0.05 profit on a $100 trade), the transaction fee and slippage easily exceed the gross profit.
- Bots or automated workflows relying on this calculation execute loss-making transactions where gross profit is positive but net profit after gas/fees is negative.

## Proposed Solution
Incorporate all transaction costs into net profit calculation:
1. Deduct AMM pool swap fee: `feeBps = 30` (0.3%).
2. Deduct estimated Horizon transaction fee in asset value (`baseFee * operationsCount * xlmExchangeRate`).
3. Apply a minimum profitability threshold (e.g. net profit must exceed $0.50 and > 0.2% ROI).
4. Return both `grossProfit` and `netProfit` in the response payload.

## Implementation Steps
1. Update `calculateArbitrage` in `amm.js` to compute `netProfit` after gas and swap fees.
2. Fetch current base fee from `getFeeStats()`.
3. Flag `isProfitable: netProfit > minThreshold`.
4. Add unit tests verifying trades with high gas costs are rejected as unprofitable.

## Acceptance Criteria
- [ ] Arbitrage calculation accounts for all network and pool fees.
- [ ] Trades with negative net yield after fees are marked unprofitable.
- [ ] API reports clear breakdown of gross profit, fees, and net yield.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1297](https://github.com/Ethereal-Future/FuTuRe/issues/1297)
