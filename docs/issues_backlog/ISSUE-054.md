# services/exchangeRate.js: Global CoinGecko rate limiting blocks concurrent queries for distinct currency pairs, throwing false failures

**Domain:** AMM & Liquidity Pools  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `caching`, `backend`  
**Issue ID:** ISSUE-054

---

## Background
In `backend/src/services/exchangeRate.js`, a rate limit guard is implemented at the function top level (lines 62-66):
```javascript
async function fetchFromCoinGecko(from, to) {
  const now = Date.now();
  if (now - lastFetchAt < API_MIN_GAP_MS) return null; // rate-limit guard
  lastFetchAt = now;
```
`API_MIN_GAP_MS` is set to 2,000 ms (2 seconds).

## Problem
- `fetchFromCoinGecko` is called per pair (`from`, `to`).
- If User 1 requests `XLM/USD` at t=0, `lastFetchAt` is set to t=0.
- If User 2 requests `XLM/EUR` at t=500ms, `now - lastFetchAt = 500 < 2000`, so `fetchFromCoinGecko` immediately returns `null`!
- Because CoinGecko returns `null`, the exchange rate service fails and returns HTTP 500 to User 2, or falls back to DEX orderbooks (which do not exist for EUR).
- Under even minimal multi-user concurrency, 80%+ of exchange rate lookups fail simply because another user made a lookup within the last 2 seconds!

## Proposed Solution
1. Replace the crude `lastFetchAt` reject-null guard with a request queue / debounce batcher.
2. Batch all requested assets and target currencies into a single CoinGecko API call: `GET /simple/price?ids=stellar,usd-coin&vs_currencies=usd,eur,gbp,php,...`.
3. Fetch all platform-supported rates periodically (e.g. every 60 seconds in a background cron worker) and store the full price matrix in Redis.
4. Client requests always read from the Redis cache instantly with 0ms delay and zero CoinGecko rate limit triggers.

## Implementation Steps
1. Create a background worker in `scheduler.js` refreshing all currency pair rates every 60 seconds.
2. Store full rate table in Redis key `rates:all`.
3. Refactor `getAllRates()` and `getRate(from, to)` to serve exclusively from Redis cache.
4. Remove the blocking `API_MIN_GAP_MS` null-return guard.
5. Add tests verifying concurrent rate requests for distinct pairs all return valid rates.

## Acceptance Criteria
- [ ] Exchange rates are served with sub-5ms latency from Redis cache.
- [ ] Concurrent queries for different currency pairs never return null.
- [ ] CoinGecko free tier API rate limits are strictly adhered to via background batching.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1301](https://github.com/Ethereal-Future/FuTuRe/issues/1301)
