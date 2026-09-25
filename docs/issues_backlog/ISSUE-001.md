# stellar-contract/lib.rs: Missing Soroban token transfer invocations in buy_yes, buy_no, and add_liquidity leave contract balance unbacked by on-chain assets

**Domain:** Soroban Smart Contracts  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `cryptography`, `critical-bug`  
**Issue ID:** ISSUE-001

---

## Background
`stellar-contract/src/lib.rs` defines a prediction market AMM contract where users can buy shares (`buy_yes`, `buy_no`), seed the pool (`seed_market`), add liquidity (`add_liquidity`), and redeem winning shares (`redeem`).

In `buy_yes` (lines 318-345) and `buy_no` (lines 347-374), the contract mutates internal pool balances:
```rust
market.yes_pool += amount;
market.yes_shares += shares;
Self::save_market(&env, market_id, &market);
```
Similarly, `add_liquidity` (lines 454-491) records:
```rust
market.lp_pool += amount;
market.total_lp_shares += lp_shares;
market.yes_pool += amount / 2;
market.no_pool += amount / 2;
```
However, nowhere in `buy_yes`, `buy_no`, `add_liquidity`, `redeem`, or `seed_market` is an actual Soroban token contract client (`soroban_sdk::token::Client`) invoked to transfer tokens (such as native XLM or a SAC/SEP-41 asset) from `buyer`/`provider` to the contract address.

## Problem
- The contract manipulates internal bookkeeping numbers (`i128`), but never holds or locks actual underlying token assets.
- Anyone can call `buy_yes` with an arbitrary `amount: 1_000_000_000` without owning or transferring any tokens, minting shares out of thin air.
- When `redeem` is called at market resolution, there are no actual tokens in contract custody to pay out to winning holders or liquidity providers.
- Without real token transfers, the prediction market is completely unbacked and vulnerable to economic exploitation and insolvency.

## Proposed Solution
Integrate a configurable Soroban token contract address (`Address`) in contract initialization (`init`). For every function requiring funds (`buy_yes`, `buy_no`, `add_liquidity`, `seed_market`), use `token::Client::new(&env, &token_address).transfer(&caller, &env.current_contract_address(), &amount)`. For `redeem`, `remove_liquidity`, and `claim_lp_fees`, use `token::Client::new(...).transfer(&env.current_contract_address(), &recipient, &payout)`.

## Implementation Steps
1. Add `token: Address` parameter to `init()` and persist `TOKEN` in contract instance storage.
2. In `buy_yes`, `buy_no`, and `seed_market`, initialize `token::Client` and transfer `amount` from `caller` to `env.current_contract_address()` after `caller.require_auth()`.
3. In `add_liquidity`, transfer `amount` from `provider` to the contract before updating LP shares.
4. In `redeem`, `remove_liquidity`, and `claim_lp_fees`, transfer the calculated payout from `env.current_contract_address()` to the recipient.
5. Update integration tests in `stellar-contract/tests/integration_test.rs` using Soroban SDK's test token client to verify real token transfers.

## Acceptance Criteria
- [ ] All market interactions transferring value invoke `token::Client::transfer`.
- [ ] Calling `buy_yes` or `add_liquidity` fails with insufficient token balance if the caller does not hold the tokens.
- [ ] Contract token balance on-chain matches the sum of active market pools, LP reserves, and undistributed fees.
- [ ] Redemption successfully transfers real tokens back to the winner.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1248](https://github.com/Ethereal-Future/FuTuRe/issues/1248)
