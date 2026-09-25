# stellar-contract/lib.rs: Dispute window has no ledger sequence or timestamp enforcement, enabling immediate front-running finalize calls

**Domain:** Soroban Smart Contracts  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`, `defi`  
**Issue ID:** ISSUE-004

---

## Background
In `stellar-contract/src/lib.rs`, `oracle_report` sets the preliminary outcome (lines 201-220):
```rust
market.outcome = Some(outcome);
// Status stays Closed; finalize moves it to Resolved after dispute window
Self::save_market(&env, market_id, &market);
```
Comments state that `finalize` should be called after the dispute window passes. However, `finalize` (lines 287-300) contains only:
```rust
pub fn finalize(env: Env, market_id: u32) -> Result<(), Error> {
    Self::require_not_paused(&env)?;
    let mut market = Self::load_market(&env, market_id)?;
    if market.status != MarketStatus::Closed && market.status != MarketStatus::EmergencyResolved {
        return Err(Error::MarketNotClosed);
    }
    if market.outcome.is_none() {
        return Err(Error::InvalidOutcome);
    }
    market.status = MarketStatus::Resolved;
...
```

## Problem
- There is zero time delay or ledger difference required between `oracle_report` and `finalize`.
- A corrupt oracle or bot can call `oracle_report` and immediately call `finalize` in the exact same ledger or block.
- Once status is `Resolved`, `dispute` cannot be called because `dispute` requires `market.status == MarketStatus::Closed`.
- The entire dispute mechanism is completely bypassed, rendering dispute protection ineffective against rogue or erroneous oracle feeds.

## Proposed Solution
Record `reported_at: u64` on `Market` when `oracle_report` is executed. Define a mandatory dispute delay (e.g. `DISPUTE_WINDOW_SECONDS: u64 = 86400` / 24 hours). In `finalize`, assert that `env.ledger().timestamp() >= market.reported_at + DISPUTE_WINDOW_SECONDS` before allowing status transition to `Resolved`.

## Implementation Steps
1. Add `reported_at: Option<u64>` to `Market` struct.
2. In `oracle_report`, set `market.reported_at = Some(env.ledger().timestamp())`.
3. In `finalize`, verify that `market.status == MarketStatus::EmergencyResolved` OR `env.ledger().timestamp() >= market.reported_at.unwrap() + DISPUTE_WINDOW_SECONDS`.
4. Return `Error::DisputeWindowOpen` if `finalize` is invoked prematurely.
5. Add tests asserting `finalize` fails immediately after `oracle_report` and succeeds only after the dispute window expires.

## Acceptance Criteria
- [ ] Calling `finalize` before the dispute window elapses returns `Error::DisputeWindowOpen`.
- [ ] Disputes can be submitted at any time during the active window.
- [ ] `EmergencyResolved` markets bypass the remaining dispute window as intended.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1251](https://github.com/Ethereal-Future/FuTuRe/issues/1251)
