# services/lowBalanceMonitor.js: Balance monitoring poll loop loads unbounded accounts without keyset pagination or ledger cursor tracking

**Domain:** Stellar Blockchain Services  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `backend`, `performance`  
**Issue ID:** ISSUE-030

---

## Background
`backend/src/services/lowBalanceMonitor.js` checks platform and user Stellar accounts for low XLM balances (below base reserve or fee-bump threshold) to alert administrators or prompt users to fund their accounts.

## Problem
- The balance monitor queries all user accounts from the database via `prisma.user.findMany()` with no limit, pagination, or chunking.
- For each account, it calls `getHorizonServer().loadAccount(publicKey)` sequentially in a loop.
- With 10,000 users, this triggers 10,000 consecutive Horizon requests every polling tick!
- This exhausts Horizon rate limits (HTTP 429), causes server memory spikes, and blocks the event loop for tens of minutes.

## Proposed Solution
1. Keyset-paginate database queries in batches of 100 accounts using cursor-based pagination.
2. Filter for accounts that have had active transactions in the last 7 days rather than checking dormant accounts every tick.
3. Use Horizon streaming (`stream({ onmessage: ... })`) or cursor-based ledger transaction monitoring to detect balance changes reactively rather than polling every account.
4. Add rate limiting / concurrency throttling (e.g. 5 concurrent Horizon calls) using `p-limit`.

## Implementation Steps
1. Refactor `lowBalanceMonitor` to paginate database queries with `take: 100` and cursor.
2. Use `p-limit` with concurrency of 5 to bound parallel Horizon requests.
3. Store `lastCheckedAt` on user records to avoid re-checking recently inspected accounts.
4. Add metric tracking `accounts_monitored_total` and `low_balance_alerts_total`.

## Acceptance Criteria
- [ ] Balance monitoring executes in bounded batch sizes.
- [ ] Horizon rate limits are not exceeded during polling ticks.
- [ ] Memory usage remains constant regardless of total registered users.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1277](https://github.com/Ethereal-Future/FuTuRe/issues/1277)
