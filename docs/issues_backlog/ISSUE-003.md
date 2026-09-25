# stellar-contract/lib.rs: Market struct lacks deadline and expiry validation, allowing oracle reports and resolutions at arbitrary times

**Domain:** Soroban Smart Contracts  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `security`, `defi`  
**Issue ID:** ISSUE-003

---

## Background
The `Market` struct in `stellar-contract/src/lib.rs` (lines 28-48) defines:
```rust
pub struct Market {
    pub creator: Address,
    pub question: soroban_sdk::String,
    pub yes_shares: i128,
    pub no_shares: i128,
    pub yes_pool: i128,
    pub no_pool: i128,
    pub lp_pool: i128,
    pub lp_fees: i128,
    pub status: MarketStatus,
    pub outcome: Option<bool>,
    pub dispute_bond: i128,
    pub disputer: Option<Address>,
    pub oracle: Option<Address>,
    pub total_lp_shares: i128,
}
```
`create_market` only takes `question` and `oracle`, without specifying a `close_time` or `resolution_deadline`.

## Problem
- A market creator or admin can call `close_market` immediately after creating it or during live betting without warning, halting trading arbitrarily.
- An oracle can call `oracle_report` before the underlying real-world event has occurred, resolving bets prematurely.
- There is no expiration time after which an abandoned market (where the oracle never reported) can be cancelled or refunded to depositors, leading to stuck funds.

## Proposed Solution
Add `close_time: u64` and `resolution_deadline: u64` (ledger timestamps) to `Market` and `create_market`. Enforce that trading is open only while `env.ledger().timestamp() < close_time`. Require `env.ledger().timestamp() >= close_time` before `oracle_report` can be called. Add a permissionless timeout mechanism allowing participants to cancel and refund if the oracle fails to report before `resolution_deadline`.

## Implementation Steps
1. Add `close_time: u64` and `resolution_deadline: u64` fields to `Market` struct and `create_market` signature.
2. In `buy_yes`, `buy_no`, and `add_liquidity`, assert `env.ledger().timestamp() < market.close_time`.
3. In `oracle_report`, assert `env.ledger().timestamp() >= market.close_time`.
4. Add an `emergency_timeout_refund(market_id)` function that transitions status to `Cancelled` if `env.ledger().timestamp() > market.resolution_deadline` and no outcome was reported.
5. Add unit tests verifying timestamp boundaries.

## Acceptance Criteria
- [ ] Trades rejected once `close_time` has elapsed.
- [ ] Oracle cannot submit outcome before `close_time`.
- [ ] Participants can trigger automatic market cancellation and refund if oracle abandons market past `resolution_deadline`.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1250](https://github.com/Ethereal-Future/FuTuRe/issues/1250)
