# ADR-0001: Use Stellar as the Blockchain Layer

* Status: Accepted
* Deciders: Core engineering team
* Date: 2026-01-15

## Context and Problem Statement

The FuTuRe platform needs a blockchain network to settle cross-border payments. The network must support fast finality, low transaction fees, and native multi-currency assets so that recipients in different countries can receive local-currency stablecoins without requiring a separate DEX integration.

## Decision Drivers

* Transaction fees must be negligible compared to the payment amount (< $0.01 per transfer)
* Settlement must complete in under 10 seconds for a good user experience
* Must support non-XLM assets (stablecoins, local-currency tokens) natively
* Mature SDK with JavaScript/Node.js support required
* Must have a public testnet for development and QA

## Considered Options

* **Stellar** — purpose-built payments network with native asset support and SDEX
* **Ethereum (L1)** — largest smart-contract ecosystem, but gas fees are prohibitive for micropayments
* **Polygon** — EVM-compatible L2 with lower fees, but adds bridge complexity and EVM tooling overhead
* **Ripple XRP Ledger** — similar payment focus, but SDK ecosystem is smaller and the token's regulatory status is uncertain

## Decision Outcome

Chosen option: **Stellar**, because it directly satisfies all decision drivers out of the box.

Stellar's BASE_FEE is 100 stroops (0.00001 XLM ≈ $0.000001 at current rates), well under any reasonable threshold. Ledger close time averages 3–5 seconds. The Stellar network natively supports custom assets and trustlines, meaning cross-currency paths are handled by the built-in SDEX order book without a separate smart-contract layer. The `@stellar/stellar-sdk` npm package provides first-class JS support.

### Positive Consequences

* Extremely low and predictable transaction costs
* Sub-5-second finality without layer-2 bridging
* Native multi-currency support via trustlines and path payments
* Active Friendbot testnet removes dev-environment friction
* Fee-bump transactions allow the platform to sponsor fees for low-balance users

### Negative Consequences

* Smaller developer ecosystem than Ethereum; fewer available third-party auditors
* Limited programmability compared to EVM smart contracts — complex escrow logic requires off-chain coordination
* Network decentralisation is lower than Ethereum (validator set is quorum-based)

## Pros and Cons of the Options

### Ethereum (L1)

* Good, because largest developer ecosystem and auditor pool
* Good, because ERC-20 standard widely understood
* Bad, because gas fees (often $5–$50+) are impractical for remittance micro-payments
* Bad, because 12-second block time + probabilistic finality adds UX latency

### Polygon

* Good, because EVM-compatible, lower fees than Ethereum L1
* Good, because large liquidity base
* Bad, because bridge adds withdrawal latency and smart-contract risk
* Bad, because EVM tooling required for a payments use case that doesn't need smart contracts

### Ripple XRP Ledger

* Good, because purpose-built payments, fast finality, low fees
* Good, because native DEX similar to Stellar SDEX
* Bad, because ongoing SEC litigation creates regulatory uncertainty
* Bad, because smaller JS SDK ecosystem compared to Stellar
