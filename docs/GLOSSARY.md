# Glossary

Definitions for Stellar-protocol and remittance/compliance terms actually used in this codebase — not the full Stellar protocol glossary. For the exhaustive reference, see [developers.stellar.org](https://developers.stellar.org).

Each entry links to the ADR, guide, or source file where the concept is used in this repo.

---

### Account

A Stellar ledger entry identified by a public key that holds a native XLM balance and, optionally, [trustlines](#trustline) to other assets. This platform creates one per user via `createAccount()` in [`backend/src/services/stellar.js`](../backend/src/services/stellar.js).

### Anchor

A service that bridges Stellar assets to real-world value (e.g. depositing/withdrawing local currency), discovered via its `stellar.toml` file. This platform acts as a *sending* anchor when handing off cross-border payments — see [`backend/src/services/sep31.js`](../backend/src/services/sep31.js) and [SEP](#sep-stellar-ecosystem-proposal) below.

### AML (Anti-Money Laundering)

Automated monitoring that screens completed payments for suspicious patterns and creates `AMLAlert` records. Implemented in `amlMonitor.screenTransaction()`; rules (`LARGE_TX`, `STRUCTURING`, `VELOCITY`, `UNVERIFIED_USER`) and their thresholds are documented in the [AML transaction monitoring](../backend/CONFIGURATION.md#aml-transaction-monitoring-502) section of `backend/CONFIGURATION.md`.

### Base Fee

The minimum XLM cost per Stellar operation (100 stroops on both testnet and mainnet). This platform references `StellarSDK.BASE_FEE` throughout [`backend/src/services/stellar.js`](../backend/src/services/stellar.js) when building transactions, and multiplies it for [fee-bump transactions](#fee-bump-transaction). See the fee rationale in [ADR-0001](adr/0001-stellar-blockchain.md).

### Fee-bump transaction

A wrapper transaction where a sponsor account (`PLATFORM_FEE_ACCOUNT_SECRET`) pays the network fee on behalf of a low-balance sender, so a user with too little XLM to cover fees can still transact. Configured via `FEE_BUMP_THRESHOLD_XLM` and `FEE_BUMP_MULTIPLIER` in [`backend/CONFIGURATION.md`](../backend/CONFIGURATION.md#stellar).

### Federation address

A human-readable identifier in the form `name*domain.com` that resolves to a Stellar public key, similar to an email address standing in for an account ID. This platform both resolves and serves federation addresses — see [`backend/src/services/federation.js`](../backend/src/services/federation.js) and [SEP-1](#sep-stellar-ecosystem-proposal).

### Friendbot

Stellar's automated testnet account-funding service. It credits a new or unfunded public key with 10,000 test XLM. This platform calls it directly in `createAccount()` ([`backend/src/services/stellar.js`](../backend/src/services/stellar.js)) and via the standalone [`scripts/fund-testnet-account.sh`](../scripts/fund-testnet-account.sh) helper. See the [README's Friendbot section](../README.md#friendbot) and the [Troubleshooting guide](guides/troubleshooting.md#stellar-testnet) for what to do when it rate-limits.

### GDPR data export

The right-of-access mechanism required by GDPR Article 15. Users request their full data via `GET /api/auth/data-export`; account deletion (`DELETE /api/auth/account`) implements Article 17 erasure. Documented in the [Data Retention Policy](../backend/CONFIGURATION.md#data-retention-policy-gdpr) section of `backend/CONFIGURATION.md`.

### Horizon

Stellar's REST API server that this platform's backend calls to submit transactions, read balances, and stream events. The endpoint is configured via `HORIZON_URL` (testnet: `https://horizon-testnet.stellar.org`, mainnet: `https://horizon.stellar.org`) — see the [Testnet vs. Mainnet table](../README.md#testnet-vs-mainnet-configuration) in the README and [`docs/runbooks/horizon-outage.md`](runbooks/horizon-outage.md) for what to do when it's unavailable.

### KYC (Know Your Customer)

Identity verification required before a user can send payments above `KYC_LARGE_TRANSACTION_LIMIT` XLM. Enforced in `POST /api/stellar/payment/send`, which returns `403 { error: "KYC_REQUIRED" }` when the sender lacks an `APPROVED` KYC record. See [`backend/CONFIGURATION.md`](../backend/CONFIGURATION.md#kyc-enforcement).

### Memo

An optional text/ID field attached to a Stellar transaction, commonly used to route a payment to the correct sub-account at an exchange or anchor. This platform clears (nulls) transaction memos on account deletion while retaining amounts and hashes for audit purposes — see [Account deletion](../backend/CONFIGURATION.md#account-deletion) in `backend/CONFIGURATION.md`.

### Multisig (multi-signature account)

A Stellar account configured to require signatures from more than one key before a transaction is valid. This platform supports multisig accounts with expiring signer requests — see [`backend/src/routes/multiSig.js`](../backend/src/routes/multiSig.js) and the `add_multisig_expires_at` Prisma migration.

### Network passphrase

A string that scopes a signed transaction to a specific Stellar network, preventing a transaction signed for testnet from being replayed on mainnet (or vice versa). Testnet uses `Test SDF Network ; September 2015`; mainnet uses `Public Global Stellar Network ; September 2015` — see the [Testnet vs. Mainnet table](../README.md#testnet-vs-mainnet-configuration) in the README.

### Path payment

A Stellar payment that automatically converts between assets along an order-book path, letting a sender pay in one asset while the recipient receives another. Implemented in `sendPathPayment()` in [`backend/src/services/pathPayment.js`](../backend/src/services/pathPayment.js), called out from `stellar.js`.

### Public key / Secret key (Stellar keypair)

A Stellar account is controlled by an Ed25519 keypair: the public key (starts with `G`) is the account identifier — safe to share, and what Friendbot funds — while the secret key (starts with `S`) signs transactions and must never be exposed. Generated via `StellarSDK.Keypair.random()` in `createAccount()` ([`backend/src/services/stellar.js`](../backend/src/services/stellar.js)). See [Private key management](guides/security.md) in the security guide for storage guidance.

### Refresh token rotation

An auth pattern where each use of a refresh token invalidates it and issues a new one; reuse of an already-rotated token revokes the entire token family, detecting theft. This platform's rationale and trade-offs are documented in [ADR-0004](adr/0004-auth-approach.md).

### SAR (Suspicious Activity Report)

A compliance report filed with regulators when AML monitoring flags a pattern warranting review (e.g. `STRUCTURING` or `VELOCITY` alerts — see [AML](#aml-anti-money-laundering) above). Referenced in the commit message conventions in [`CONTRIBUTING.md`](../CONTRIBUTING.md) (`fix(compliance): filter MEDIUM alerts from SAR reports`).

### Sanctions screening

Checks every payment's sender and recipient against OFAC SDN, UN, and EU sanctions lists before submitting the transaction to Stellar; a match returns `403 { error: "SANCTIONS_HIT" }`. Configured via `SANCTIONS_API_KEY`/`SANCTIONS_API_URL` — see [Sanctions screening (#501)](../backend/CONFIGURATION.md#sanctions-screening-501) in `backend/CONFIGURATION.md`.

### Sequence number

A per-account counter that must be incremented by exactly one for each transaction an account submits, preventing replay and enforcing ordering. Read and incremented throughout [`backend/src/services/stellar.js`](../backend/src/services/stellar.js) when building transactions.

### SEP (Stellar Ecosystem Proposal)

A numbered Stellar protocol extension, analogous to an RFC. This platform implements:

- **SEP-1** (`stellar.toml`) — published via `buildStellarToml()` in [`backend/src/services/federation.js`](../backend/src/services/federation.js), used for both federation and anchor discovery.
- **SEP-31** (Cross-Border Payments API) — sending-anchor client in [`backend/src/services/sep31.js`](../backend/src/services/sep31.js), used to hand off payments to a receiving anchor in the recipient's country.

### Soroban

Stellar's smart-contract platform. This platform's prediction-market contract lives in [`stellar-contract/`](../stellar-contract/README.md) and is deployed against `SOROBAN_RPC_URL` (defaults to `https://soroban-testnet.stellar.org` on testnet).

### Testnet / Mainnet

Stellar runs a persistent production network (mainnet, real value) and a public test network (testnet, free test XLM, reset roughly every three months). Controlled by `STELLAR_NETWORK` — see the full [Testnet vs. Mainnet Configuration table](../README.md#testnet-vs-mainnet-configuration) in the README and the [Stellar testnet section](guides/troubleshooting.md#stellar-testnet) of the troubleshooting guide for reset recovery.

### Trustline

An explicit opt-in an account makes to hold a non-XLM asset, capping the amount it will accept from a given issuer. Native XLM needs no trustline. Cited as a core reason for choosing Stellar in [ADR-0001](adr/0001-stellar-blockchain.md) and as a cache-invalidation trigger in [ADR-0003](adr/0003-caching-strategy.md).

### XLM (Lumens)

Stellar's native asset, used to pay network fees and as the platform's default payment currency. See [Features](../README.md#features) in the README.
