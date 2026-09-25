# stellar-contract/lib.rs: Storage entries lack Soroban State TTL extension (extend_ttl), risking permanent contract state archival and lockout

**Domain:** Soroban Smart Contracts  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `resilience`, `architecture`  
**Issue ID:** ISSUE-002

---

## Background
Soroban smart contracts on Stellar Mainnet and Testnet implement state expiration (State Archival). Every instance storage key (`ADMIN`, `TREASURY`, `PAUSED`, `MKT_CNT`) and persistent storage key (`(MKT, id)`, `(POS, market_id, user)`) has a Time-To-Live (TTL) measured in ledgers.

In `stellar-contract/src/lib.rs`:
```rust
fn load_market(env: &Env, id: u32) -> Result<Market, Error> {
    let key = (symbol_short!("MKT"), id);
    env.storage().persistent().get(&key).ok_or(Error::MarketNotFound)
}
```
The contract reads and writes persistent and instance storage without calling `env.storage().instance().extend_ttl(...)` or `env.storage().persistent().extend_ttl(&key, ...)`.

## Problem
- On live networks (Testnet and Mainnet), entries that are not periodically extended will expire and be moved to the archive.
- If a market has a resolution date 30 days in the future, and no transactions touch it for the network threshold (e.g. 100,000 ledgers), the `Market` state and all user `Position` entries will expire.
- Callers attempting to `oracle_report`, `dispute`, or `redeem` will receive `MarketNotFound` or fail at the host level, permanently locking user capital unless a costly manual state restoration transaction is submitted.

## Proposed Solution
Implement automatic TTL extension on all read and write storage paths using `extend_ttl(threshold, extend_to)`. Define safe ledger constants (e.g., threshold of 10,000 ledgers, extending to 100,000 ledgers) and invoke `env.storage().instance().extend_ttl(...)` in admin and market functions, and `env.storage().persistent().extend_ttl(&key, ...)` whenever a market or position is accessed.

## Implementation Steps
1. Define `INSTANCE_BUMP_THRESHOLD` and `INSTANCE_EXTEND_TO` ledger constants in `stellar-contract/src/lib.rs`.
2. Define `PERSISTENT_BUMP_THRESHOLD` and `PERSISTENT_EXTEND_TO` constants for market and position storage.
3. Add `extend_ttl` calls in `load_market`, `save_market`, `load_position`, and `save_position`.
4. Add instance storage TTL extension in `require_not_paused` and `init`.
5. Write a Soroban test verifying that storage TTLs are extended upon market query and interaction.

## Acceptance Criteria
- [ ] All instance and persistent storage keys have their TTL extended upon access.
- [ ] Markets active for extended periods do not expire before resolution and redemption.
- [ ] Tests assert that `env.storage().instance().get_ttl()` and persistent storage TTLs remain above the threshold.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1249](https://github.com/Ethereal-Future/FuTuRe/issues/1249)
