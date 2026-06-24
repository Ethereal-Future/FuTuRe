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

## Docker (recommended for local development)

Docker Compose spins up the full stack — PostgreSQL, Redis, backend, and frontend — with a single command. No local database installation required.

### Start

```bash
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- PostgreSQL: `localhost:5432` (user `future_admin`, db `future_remittance`, password `dev_password`)
- Redis: `localhost:6379`

Prisma migrations run automatically on backend startup. Source directories are bind-mounted so the backend (`node --watch`) and frontend (Vite HMR) both hot-reload on file changes.

### Stop

```bash
docker compose down          # stop containers, keep the db volume
docker compose down -v       # stop and delete the db volume
```

### Local overrides

To customise ports, credentials, or log levels without editing the shared file:

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
# edit docker-compose.override.yml — it is git-ignored
docker compose up --build
```

### Service communication

| From | To | Address |
|---|---|---|
| backend | postgres | `postgres:5432` |
| backend | redis | `redis:6379` |
| frontend (Vite proxy) | backend | `http://backend:3001` |
| browser | frontend | `http://localhost:3000` |
| browser | backend | `http://localhost:3001` |

## Usage

1. Click "Create Account" to generate a new Stellar keypair
2. Account is automatically funded on testnet via Friendbot
3. Check balance to see your XLM
4. Send payments to other Stellar addresses

## Testnet Setup

### Friendbot

Friendbot is Stellar's automated account-funding service for the testnet. It credits any new (or unfunded) Stellar public key with **10,000 test XLM** at no cost, letting you start testing payments immediately without real funds.

Fund an account via the API directly:

```bash
curl "https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY"
```

Or use the bundled helper script (see `scripts/fund-testnet-account.sh`):

```bash
bash scripts/fund-testnet-account.sh GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
```

The app calls Friendbot automatically when you click **Create Account** in the UI.

### Testnet Limitations

- **Quarterly resets** — the Stellar testnet is wiped roughly every three months. All accounts, balances, and transaction history are deleted. You must re-fund accounts after each reset.
- Test XLM has no monetary value and cannot be transferred to mainnet.
- Friendbot is only available on testnet; it does not exist on mainnet.

### Testnet vs. Mainnet Configuration

| Setting | Testnet | Mainnet |
|---|---|---|
| `STELLAR_NETWORK` | `testnet` | `mainnet` |
| `HORIZON_URL` | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| Network passphrase | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| Friendbot available | ✅ Yes | ❌ No |
| Real funds | ❌ No | ✅ Yes |

Set `STELLAR_NETWORK=testnet` (the default) in `backend/.env` for local development. Change to `mainnet` only for production deployments.

## Next Steps

- Add stablecoin support (USDC)
- Integrate fiat on/off ramps
- Add exchange rate conversion
- Implement KYC/AML compliance
- Add transaction history
- Mobile app development

## Guides

- [Security best practices for integrators](docs/guides/security.md) — API key storage, webhook verification, private key management, CSP, replay attacks, front-running
- [Operational Runbook](docs/runbook.md) — Server restart, DB migration rollback, stream cancellation, IP unblock, incident response

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
