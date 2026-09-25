# stellar-contract/lib.rs: admin_uphold_dispute fails to return dispute bond to disputer, permanently trapping bond funds in storage

**Domain:** Soroban Smart Contracts  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `defi`  
**Issue ID:** ISSUE-005

---

## Background
In `stellar-contract/src/lib.rs`, `dispute` allows a user to challenge an oracle outcome by staking a bond (lines 222-241):
```rust
market.status = MarketStatus::Disputed;
market.disputer = Some(disputer.clone());
market.dispute_bond = bond;
```
When admin rejects the dispute, `admin_reject_dispute` slashes the bond to treasury (lines 261-284).

However, when admin upholds the dispute via `admin_uphold_dispute` (lines 244-259):
```rust
pub fn admin_uphold_dispute(
    env: Env,
    caller: Address,
    market_id: u32,
    new_outcome: bool,
) -> Result<(), Error> {
    caller.require_auth();
    Self::require_admin(&env, &caller)?;
    let mut market = Self::load_market(&env, market_id)?;
    Self::require_status(&market, &MarketStatus::Disputed)?;
    market.outcome = Some(new_outcome);
    market.status = MarketStatus::EmergencyResolved;
    Self::save_market(&env, market_id, &market);
    Self::emit(&env, symbol_short!("upheld"), (market_id, caller, new_outcome));
    Ok(())
}
```

## Problem
- When a dispute is upheld (confirming the disputer was correct), `market.dispute_bond` is never refunded to `market.disputer`.
- The bond is not credited to the disputer's balance, nor transferred back via token client, nor is `market.dispute_bond` reset to 0.
- Honest disputers who catch malicious or faulty oracle reports lose their entire bond permanently, creating a massive economic disincentive to dispute false outcomes.

## Proposed Solution
In `admin_uphold_dispute`, refund `market.dispute_bond` back to `market.disputer`. If token transfers are active, invoke `token::Client::transfer` from the contract to the disputer. Reset `market.dispute_bond = 0` and `market.disputer = None`, and emit a `dispute_refunded` event.

## Implementation Steps
1. In `admin_uphold_dispute`, extract `disputer = market.disputer.clone().ok_or(Error::Unauthorized)?`.
2. Transfer `market.dispute_bond` tokens back to `disputer`.
3. Optionally award a configurable bounty or percentage of slashed fees to reward successful dispute reporting.
4. Reset `market.dispute_bond = 0` and `market.disputer = None`.
5. Add integration test verifying that disputer's token balance increases by the bond amount when upheld.

## Acceptance Criteria
- [ ] Disputer receives 100% of their bond back when dispute is upheld by admin.
- [ ] `market.dispute_bond` is cleared in storage after upholding.
- [ ] Test validates bond refund flow.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1252](https://github.com/Ethereal-Future/FuTuRe/issues/1252)
