# services/assetConverter.js: Currency conversion rates use unweighted arithmetic averages across divergent liquidity pools

**Domain:** AMM & Liquidity Pools  
**Complexity:** Medium  
**Labels:** `bug`, `amm`, `analytics`, `backend`  
**Issue ID:** ISSUE-053

---

## Background
In `backend/src/services/assetConverter.js`, when multiple pools exist for an asset pair (e.g. XLM/USDC pools with different fee tiers or DEX orderbook plus AMM pool), the converter averages the prices:
```javascript
const avgRate = rates.reduce((sum, r) => sum + r, 0) / rates.length;
```

## Problem
- Simple arithmetic averaging gives equal weight to a micro-pool with $10 in liquidity and a primary pool with $5,000,000 in liquidity.
- An attacker can create a low-liquidity pool with a distorted price (e.g. 1 XLM = $100), skewing the platform's displayed conversion rate and portfolio valuation.
- Users viewing portfolio balances or currency conversions see inaccurate fiat equivalents.

## Proposed Solution
Implement Volume-Weighted Average Price (VWAP) or Liquidity-Weighted Price:
```javascript
const totalWeight = pools.reduce((sum, p) => sum + p.liquidity, 0);
const weightedRate = pools.reduce((sum, p) => sum + (p.midPrice * p.liquidity), 0) / totalWeight;
```
Exclude pools with total liquidity below a minimum threshold (e.g. $1,000 equivalent) from price calculation.

## Implementation Steps
1. Refactor `assetConverter.js` to weight rates by pool liquidity (`sqrt(reserveA * reserveB)`).
2. Filter out outlier pools with less than `MIN_POOL_LIQUIDITY_USD`.
3. Add unit tests with high-liquidity and low-liquidity pool fixtures asserting VWAP accuracy.

## Acceptance Criteria
- [ ] Conversion rates reflect liquidity-weighted market reality.
- [ ] Low-liquidity outlier pools cannot manipulate conversion pricing.
- [ ] Portfolio valuation displays accurate fiat equivalents.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1300](https://github.com/Ethereal-Future/FuTuRe/issues/1300)
