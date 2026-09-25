# routes/stellar/convert.js: Quote endpoint returns stale conversion rates during rapid market volatility without quote expiration timestamps

**Domain:** AMM & Liquidity Pools  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `amm`, `backend`  
**Issue ID:** ISSUE-055

---

## Background
In `backend/src/routes/stellar/convert.js`, `GET /convert/:from/:to/:amount` calculates a conversion quote and returns `{ quote, rate, from, to, amount }` without any `validUntil`, `quoteId`, or expiration timestamp.

## Problem
- A user fetches a quote, leaves the conversion modal open in their browser for 15 minutes, and then clicks "Confirm Swap".
- The client submits the payment expecting the quoted rate, but market rates have moved significantly.
- The transaction either fails on-chain due to slippage or executes at an unexpected rate, leading to user complaints and dispute filings.
- There is no guarantee that a quote provided by the server remains valid for any guaranteed time window.

## Proposed Solution
1. Return `quoteId`, `validUntil` (ISO timestamp 60 seconds from generation), and `guaranteedRate` in the quote response.
2. Cache the quote in Redis with key `quote:${quoteId}` and TTL 60 seconds.
3. When executing the conversion payment, require `quoteId` and assert `new Date() <= quote.validUntil`.
4. If quote has expired, return HTTP 410 Gone / 422 Unprocessable Entity with error `QuoteExpired: Please refresh for a current rate`.

## Implementation Steps
1. Add `quoteId` (UUID) and `expiresAt` (60s TTL) to `/convert` quote response.
2. Persist quote payload in Redis `quote:${quoteId}`.
3. In conversion execution route, validate `quoteId` exists and is within validity window.
4. Add unit tests for quote generation, expiration, and swap execution with valid vs expired quote IDs.

## Acceptance Criteria
- [ ] Quotes include explicit 60-second validity timestamps.
- [ ] Expired quotes are rejected before transaction submission.
- [ ] Users are guaranteed price protection within the quote validity window.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1302](https://github.com/Ethereal-Future/FuTuRe/issues/1302)
