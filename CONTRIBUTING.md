# Contributing to FuTuRe

Thanks for taking the time to contribute. This guide covers everything you need to get a working local environment, run the test suite, and get your PR reviewed.

## Prerequisites

- Node.js 20.x (see `.nvmrc` or use `nvm use 20`)
- npm 10+ (bundled with Node 20)
- PostgreSQL 16 (or use the provided Docker Compose setup)
- Git

Optional but recommended:
- Docker + Docker Compose (simplifies database setup)
- [k6](https://k6.io/docs/get-started/installation/) for load tests

---

## Local Setup

### 1. Clone and install

```bash
git clone https://github.com/Ethereal-Future/FuTuRe.git
cd FuTuRe
npm install
```

### 2. Configure the backend

```bash
cd backend
cp .env.example .env
```

Open `backend/.env` and fill in the required values. At minimum you need:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — any strong random string for local dev
- `STREAM_SECRET_ENCRYPTION_KEY` — 32-byte hex key (see comment in `.env.example`)

See `backend/CONFIGURATION.md` for the full reference.

### 3. Start PostgreSQL

Using Docker (recommended):

```bash
# from the repo root
docker compose up db -d
```

Or point `DATABASE_URL` at an existing local PostgreSQL 16 instance.

### 4. Run database migrations

```bash
cd backend
npx prisma migrate deploy
```

### 5. Start the development servers

From the repo root:

```bash
npm run dev
```

This starts both servers concurrently:

| Service  | URL                    |
|----------|------------------------|
| Backend  | http://localhost:3001  |
| Frontend | http://localhost:3000  |

The backend uses `--watch` for hot-reload. The frontend uses Vite HMR.

---

## Running Tests

### Unit and integration tests (with coverage)

```bash
npm run test:coverage
```

### Backend-only tests

```bash
npm run test --workspace=backend
```

### Database integration tests

Requires a running PostgreSQL instance (use `docker compose up db -d`):

```bash
npm run test:db --workspace=backend
```

### Contract tests

```bash
npm run test:contracts
```

### Property-based tests

```bash
npm run test:property
```

### Load tests

Requires [k6](https://k6.io/docs/get-started/installation/) and a running backend:

```bash
npm run load-test:endpoints --workspace=backend
npm run load-test:concurrent --workspace=backend
npm run load-test:regression --workspace=backend
```

---

## Running Against Testnet

The backend connects to the Stellar testnet by default. To run against it:

1. Set these values in `backend/.env`:

```env
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
```

2. Start the backend:

```bash
npm run dev:backend
```

3. Create a test account via the frontend or the API — new accounts are automatically funded by [Friendbot](https://developers.stellar.org/docs/tutorials/create-account).

> Never use real Stellar mainnet keys in development. The testnet is reset periodically; any balances will be lost.

---

## PR Review Process

1. Fork the repo and create a branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```

2. Make your changes. Keep commits focused — one logical change per commit.

3. Ensure all checks pass locally before pushing:
   ```bash
   npm run test:coverage
   npm audit --audit-level=high
   ```

4. Push your branch and open a pull request against `main`.

5. Fill in the PR template. Include:
   - What the change does and why
   - How you tested it
   - Any follow-up work or known limitations

6. A maintainer will review within a few business days. Address feedback by pushing new commits — do not force-push after review has started.

7. Once approved, a maintainer will squash-merge your PR.

### PR checklist

- [ ] Tests added or updated for new behaviour
- [ ] `npm run test:coverage` passes
- [ ] No new high/critical vulnerabilities (`npm audit --audit-level=high`)
- [ ] Code formatted with `npm run format`
- [ ] PR description explains the change clearly
