# services/pool.js: Liquidity pool deposit operations fail to assert trustlines for pool share assets prior to submission

**Domain:** AMM & Liquidity Pools  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `amm`, `defi`  
**Issue ID:** ISSUE-051

---

## Background
On Stellar, liquidity pool shares are represented as an asset of type `liquidity_pool_shares` with a unique pool ID.
To deposit into a liquidity pool via `Operation.liquidityPoolDeposit`, the depositing account MUST have an active trustline established for that specific `LiquidityPoolId` asset (or establish it in the exact same transaction via `Operation.changeTrust`).
In `backend/src/services/pool.js`, `executeDeposit` builds the deposit transaction:
```javascript
txBuilder.addOperation(
  StellarSDK.Operation.liquidityPoolDeposit({
    liquidityPoolId: poolId,
    maxAmountA,
    maxAmountB,
    minPrice,
    maxPrice,
  })
);
```

## Problem
- If the depositing account does not already have an established trustline for the pool share asset:
  - Stellar core immediately rejects the transaction with `op_no_trust` (operation failed: trustline missing).
  - The transaction fails on-chain, consuming transaction fees without executing the deposit.
- The service does not inspect the source account's existing trustlines or automatically prepend `Operation.changeTrust({ asset: new StellarSDK.LiquidityPoolAsset(poolId) })`.

## Proposed Solution
Before building `liquidityPoolDeposit`:
1. Check `sourceAccount.balances` for a balance entry where `asset_type === 'liquidity_pool_shares'` and `liquidity_pool_id === poolId`.
2. If no trustline exists, prepend a `changeTrust` operation to the transaction:
```javascript
txBuilder.addOperation(
  StellarSDK.Operation.changeTrust({
    asset: new StellarSDK.LiquidityPoolAsset(poolId),
  })
);
```
3. Verify the source account has sufficient available XLM reserve to establish the new trustline (0.5 XLM base reserve).

## Implementation Steps
1. In `executeDeposit` in `services/pool.js`, inspect `sourceAccount.balances`.
2. If pool trustline is absent, check available reserve (`xlmBalance - subentryReserve`).
3. Automatically append `changeTrust` operation before `liquidityPoolDeposit`.
4. Add integration test verifying automatic trustline establishment during initial pool deposit.

## Acceptance Criteria
- [ ] Depositing into a new pool automatically establishes the required pool share trustline.
- [ ] Accounts without trustline do not fail with `op_no_trust`.
- [ ] Reserve requirements are validated prior to transaction construction.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1298](https://github.com/Ethereal-Future/FuTuRe/issues/1298)
