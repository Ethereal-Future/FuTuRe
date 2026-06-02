# Stellar Remittance Platform

A cross-border remittance application built on the Stellar blockchain, enabling fast and low-cost international money transfers.

This repository includes both frontend and backend services for building a Stellar payment experience.

## Features

- Create Stellar accounts
- Check account balances
- Send XLM payments
- Low transaction fees (~$0.00001)
- Fast settlement (3-5 seconds)

## Tech Stack

- Backend: Node.js + Express + Stellar SDK
- Frontend: React + Vite
- Blockchain: Stellar (Testnet)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure backend environment:

```bash
cd backend
cp .env.example .env
```

See `backend/CONFIGURATION.md` for environment options, validation rules, and optional encrypted secrets.

3. Configure frontend environment (optional):

```bash
cd frontend
cp .env.example .env
```

Set `VITE_API_URL` to your production API endpoint when deploying to a CDN or different domain. Leave empty for development (Vite proxy handles `/api` requests to `localhost:3001`).

4. Start development servers:

```bash
npm run dev
```

Backend runs on http://localhost:3001
Frontend runs on http://localhost:3000

## Usage

1. Click "Create Account" to generate a new Stellar keypair
2. Account is automatically funded on testnet via Friendbot
3. Check balance to see your XLM
4. Send payments to other Stellar addresses

## Next Steps

- Add stablecoin support (USDC)
- Integrate fiat on/off ramps
- Add exchange rate conversion
- Implement KYC/AML compliance
- Add transaction history
- Mobile app development

## Guides

- [Security best practices for integrators](docs/guides/security.md) — API key storage, webhook verification, private key management, CSP, replay attacks, front-running

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, running tests, branch naming, PR process, code style, and commit message conventions.
## Architecture Decision Records

Key technology choices are documented as ADRs in [`docs/adr/`](docs/adr/0000-index.md):

| ADR | Decision |
|---|---|
| [ADR-0001](docs/adr/0001-stellar-blockchain.md) | Stellar as the blockchain layer |
| [ADR-0002](docs/adr/0002-prisma-orm.md) | Prisma as the ORM |
| [ADR-0003](docs/adr/0003-caching-strategy.md) | Multi-level caching (in-memory L1 + Redis L2) |
| [ADR-0004](docs/adr/0004-auth-approach.md) | JWT auth with refresh token rotation |

## Resources

- [Stellar Documentation](https://developers.stellar.org)
- [Stellar SDK](https://github.com/stellar/js-stellar-sdk)
