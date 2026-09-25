# services/pathPayment.js: Lack of intermediate asset hop limits allows complex circular paths resulting in excessive ledger transaction fees

**Domain:** AMM & Liquidity Pools  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `performance`, `backend`  
**Issue ID:** ISSUE-046

---

## Background
Stellar path payment operations accept an array of intermediate assets: `path: Asset[]`. Stellar consensus limits paths to a maximum of 5 intermediate hops.
In `backend/src/services/pathPayment.js`, path discovery queries Horizon's `/paths/strict-receive` endpoint and takes the first returned path without validating the length or quality of intermediate hops.

## Problem
- Horizon path finding can return paths with 4-5 intermediate hops involving illiquid assets with high spread.
- Multi-hop paths incur higher transaction fees on the ledger and increase the probability of transaction failure (if any intermediate pool experiences a price change or lacks reserve).
- Certain circular or redundant paths (e.g. XLM -> USDT -> USDC -> EUR -> XLM) produce extreme price degradation.
- There is no filtering or sorting by net effective rate or maximum hop count.

## Proposed Solution
1. In `findBestPath`, enforce `MAX_HOPS = 3` to limit path complexity.
2. Sort candidate paths by `source_amount` ascending, prioritizing paths with fewer hops when rates are within a tight margin (0.1%).
3. Filter out paths containing unverified or low-reputation intermediate assets from the asset registry.
4. Validate that `path.length <= 5` before constructing operations.

## Implementation Steps
1. Add path candidate filtering and sorting logic in `pathPayment.js`.
2. Reject paths with > 3 hops unless explicitly requested by caller.
3. Validate all intermediate assets against verified assets in `assetRegistry.js`.
4. Add unit tests comparing multi-hop paths and selecting the lowest-cost, lowest-risk route.

## Acceptance Criteria
- [ ] Path payments prioritize direct or single-hop routes when price differences are minimal.
- [ ] Illiquid multi-hop circular paths are pruned.
- [ ] Intermediate hops are strictly validated against trusted assets.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1293](https://github.com/Ethereal-Future/FuTuRe/issues/1293)
