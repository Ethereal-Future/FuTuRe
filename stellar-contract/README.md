# Stellar Soroban Prediction Market Contract

A Soroban smart contract for creating and managing prediction markets on the Stellar blockchain.

## Purpose

This contract enables decentralized prediction markets where users can:
- Create markets with questions and oracle resolution
- Buy YES/NO shares using a constant product AMM
- Add/remove liquidity to markets
- Redeem winnings after market resolution
- Dispute outcomes and have admin intervention

## Interface

### Functions

| Function | Description | Parameters |
|----------|-------------|------------|
| `init` | Initialize contract with admin and treasury | `admin: Address, treasury: Address` |
| `pause` | Pause all market operations (admin only) | `caller: Address` |
| `unpause` | Resume operations (admin only) | `caller: Address` |
| `create_market` | Create a new prediction market | `creator: Address, question: String, oracle: Address` |
| `seed_market` | Seed initial liquidity (YES/NO pools) | `caller: Address, market_id: u32, amount: i128` |
| `close_market` | Close market for trading | `caller: Address, market_id: u32` |
| `oracle_report` | Report outcome (oracle only) | `caller: Address, market_id: u32, outcome: bool` |
| `dispute` | Open dispute window | `disputer: Address, market_id: u32, bond: i128` |
| `finalize` | Finalize after dispute period | `market_id: u32` |
| `buy_yes` | Buy YES shares | `buyer: Address, market_id: u32, amount: i128, min_shares_out: i128` |
| `buy_no` | Buy NO shares | `buyer: Address, market_id: u32, amount: i128, min_shares_out: i128` |
| `redeem` | Redeem winnings | `redeemer: Address, market_id: u32` |
| `batch_redeem` | Redeem multiple markets | `redeemer: Address, market_ids: Vec<u32>` |
| `add_liquidity` | Add liquidity to pool | `provider: Address, market_id: u32, amount: i128` |
| `remove_liquidity` | Remove liquidity | `provider: Address, market_id: u32, lp_shares: i128` |
| `claim_lp_fees` | Claim accrued LP fees | `provider: Address, market_id: u32` |
| `split` | Split YES/NO positions | `caller: Address, market_id: u32, amount: i128` |
| `merge` | Merge split positions | `caller: Address, market_id: u32, amount: i128` |

### Views

| Function | Description |
|----------|-------------|
| `get_market` | Get market details by ID |
| `get_position` | Get user position in market |
| `get_treasury_balance` | Get current treasury balance |

### Errors

- `NotInitialized` - Contract not initialized
- `AlreadyInitialized` - Contract already initialized
- `Unauthorized` - Caller not admin or creator
- `MarketNotFound` - Invalid market ID
- `MarketNotOpen` - Market not in open state
- `MarketNotClosed` - Market not in closed state
- `MarketNotResolved` - Market not resolved
- `ContractPaused` - Contract is paused
- `InsufficientFunds` - Not enough shares/liquidity

## Events

Every state-mutating function publishes a Soroban contract event via
`env.events().publish((category, action), data)`, so off-chain indexers can
subscribe to contract activity instead of re-scanning storage. `category`
and `action` are both `Symbol`s; `data` is a tuple of the fields listed
below, in order, encoded as a Soroban `vec`.

| Topic (`category`, `action`) | Emitted by | Data fields |
|---|---|---|
| `(market, created)` | `create_market` | `market_id: u32, creator: Address, oracle: Address` |
| `(market, seeded)` | `seed_market` | `market_id: u32, caller: Address, amount: i128` |
| `(market, closed)` | `close_market` | `market_id: u32, caller: Address` |
| `(market, reported)` | `oracle_report` | `market_id: u32, caller: Address, outcome: bool` |
| `(market, disputed)` | `dispute` | `market_id: u32, disputer: Address, bond: i128` |
| `(market, upheld)` | `admin_uphold_dispute` | `market_id: u32, caller: Address, new_outcome: bool` |
| `(market, rejected)` | `admin_reject_dispute` | `market_id: u32, caller: Address, slashed_bond: i128` |
| `(market, resolved)` | `finalize` | `market_id: u32, outcome: Option<bool>` |
| `(market, cancelled)` | `cancel_market` | `market_id: u32, caller: Address` |
| `(market, traded)` | `buy_yes` / `buy_no` | `market_id: u32, buyer: Address, is_yes: bool, amount: i128, shares: i128` |
| `(market, redeemed)` | `redeem` (winning claim) | `market_id: u32, redeemer: Address, payout: i128` |
| `(market, refunded)` | `redeem` (cancelled market) | `market_id: u32, redeemer: Address, refund: i128` |
| `(market, split)` | `split` | `market_id: u32, caller: Address, amount: i128` |
| `(market, merged)` | `merge` | `market_id: u32, caller: Address, amount: i128` |
| `(liquidity, added)` | `add_liquidity` | `market_id: u32, provider: Address, amount: i128, lp_shares: i128` |
| `(liquidity, removed)` | `remove_liquidity` | `market_id: u32, provider: Address, lp_shares: i128, payout: i128` |
| `(liquidity, claimed)` | `claim_lp_fees` | `market_id: u32, provider: Address, fee_share: i128` |
| `(admin, init)` | `init` | `admin: Address, treasury: Address` |
| `(admin, paused)` | `pause` | `caller: Address` |
| `(admin, unpaused)` | `unpause` | `caller: Address` |

`batch_redeem` does not emit its own event — it drives `redeem` per market
id, so each successful redemption still emits `(market, redeemed)` or
`(market, refunded)`.

The three internal `emit`/`emit_liquidity`/`emit_admin` helpers in
`src/lib.rs` centralize this so every new state-mutating function follows
the same `(category, action)` convention.

## Backend Integration

The main backend exposes `POST /api/v1/stellar/contract/invoke` (and the compatibility
alias `/api/stellar/contract/invoke`) for signed Soroban calls.

Request body:

```json
{
  "sourceSecret": "S...",
  "contractAddress": "C... optional when STELLAR_CONTRACT_ADDRESS is set",
  "functionName": "create_market",
  "args": ["GCREATOR...", "Will XLM close above $1?", "GORACLE..."]
}
```

Responses include the Soroban transaction hash and submission status. Set
`STELLAR_CONTRACT_ADDRESS` and `SOROBAN_RPC_URL` in the backend environment after deployment.

## Deployment

### Testnet

```bash
# Install target once
rustup target add wasm32-unknown-unknown

# Build the contract
cd stellar-contract
cargo build --release

# Deploy to testnet (requires stellar/soroban CLI and a funded identity)
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/future_remittance.wasm \
  --source <testnet-identity> \
  --network testnet

# Initialize
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <testnet-identity> \
  --network testnet \
  -- init --admin <ADMIN_ADDRESS> --treasury <TREASURY_ADDRESS>
```

### Mainnet

```bash
# Build and deploy with a mainnet-funded identity
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/future_remittance.wasm \
  --source <mainnet-identity> \
  --network mainnet
```

## Integration

Set `STELLAR_CONTRACT_ADDRESS` in your `.env` file to interact with the contract via the backend API.
