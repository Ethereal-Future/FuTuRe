# services/amm.js: AMM pool state is stored in ephemeral process memory without database persistence or distributed state synchronization

**Domain:** AMM & Liquidity Pools  
**Complexity:** Hard  
**Labels:** `bug`, `amm`, `stellar`, `resilience`  
**Issue ID:** ISSUE-043

---

## Background
In `backend/src/services/amm.js`:
```javascript
const pools = new Map();
const positions = new Map();
const trades = [];
```
The service defines functions `registerPool`, `getPoolState`, `quoteSwap`, and trade execution that mutate these local in-memory JavaScript Maps and arrays.

## Problem
- When the backend runs in a multi-container environment (such as AWS ECS with `desired_count = 2+` per `infra/ecs.tf`):
  1. A pool registered on Task A is invisible to Task B.
  2. Users hitting Task B receive `Unknown pool: ${poolId}`.
  3. Swaps executed on Task A do not update reserves on Task B, causing divergent prices, arbitrage de-sync, and incorrect liquidity quotes.
- Whenever a container restarts, deploys, or crashes, all pools, LP positions, and trade history are completely erased.
- The AMM implementation is effectively a mock that cannot operate in production.

## Proposed Solution
Migrate AMM state from in-memory Maps to PostgreSQL and Redis:
1. Define Prisma models `AmmPool`, `AmmPosition`, and `AmmTrade` with appropriate indexes and decimal precision.
2. Cache pool reserves in Redis with atomic Lua scripts or `WATCH/MULTI/EXEC` transactions to guarantee atomic swaps and reserve updates under concurrent trades.
3. Synchronize pool price updates across instances using Redis Pub/Sub.

## Implementation Steps
1. Add `AmmPool`, `AmmPosition`, and `AmmTrade` models to `prisma/schema.prisma`.
2. Run Prisma migration to generate tables.
3. Refactor `registerPool`, `getPoolState`, and swap execution in `amm.js` to persist to database and Redis.
4. Use transactional atomic updates for swaps (`UPDATE amm_pools SET reserve_a = ..., reserve_b = ... WHERE id = ... AND version = ...`).
5. Write multi-instance concurrency test verifying shared pool state across instances.

## Acceptance Criteria
- [ ] AMM pool state is durable across server restarts.
- [ ] Multiple ECS container tasks share a consistent view of pool reserves and prices.
- [ ] Concurrent trades cannot corrupt pool reserves (k = x * y invariant preserved).

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1290](https://github.com/Ethereal-Future/FuTuRe/issues/1290)
