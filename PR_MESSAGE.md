# Developer Experience & CI Improvements

Closes #347, #348, #349, #357

## Summary

This PR improves the onboarding experience for new contributors and tightens the CI pipeline. A new contributor can now clone the repo, run `docker compose up`, and have a fully working local environment without any manual configuration guesswork.

## Changes

### #347 — CONTRIBUTING.md
Added a full contributing guide covering:
- Prerequisites (Node 20, PostgreSQL 16, Docker)
- Step-by-step local setup from clone to running servers
- All test commands (unit, integration, contract, property, load)
- How to run against Stellar testnet
- PR review process and checklist

### #348 — backend/.env.example
Rewrote the env file with inline documentation for every variable:
- Each entry is marked `[REQUIRED]` or `[OPTIONAL]`
- Valid values and defaults are documented inline
- Added detailed examples for `PLATFORM_FEE_ACCOUNT_SECRET`, `FEE_BUMP_THRESHOLD_XLM`, and `COINGECKO_API_KEY`
- Grouped variables by concern (Stellar, security, database, cache, etc.)

### #349 — CI vulnerability audit
Added `npm audit --audit-level=high` to `.github/workflows/test.yml` immediately after `npm install`. The build fails if any high or critical vulnerability is found in the dependency tree.

### #357 — docker-compose.yml for local development
Added a standard `docker-compose.yml` that spins up three services:
- `db` — PostgreSQL 16 with a persistent named volume
- `backend` — Node 20 with `node --watch` hot-reload; runs `prisma migrate deploy` on startup
- `frontend` — Vite dev server with HMR, proxying `/api` to the backend

Also added minimal `Dockerfile.dev` for both backend and frontend.

## Testing

- Verified `test.yml` audit step is correctly positioned and uses the right flag
- `CONTRIBUTING.md` setup steps validated against the actual project scripts and `.env.example` values
- Docker Compose service dependencies and healthchecks confirmed against the test compose file patterns already in the repo

## Notes

- The `STREAM_SECRET_ENCRYPTION_KEY` in `docker-compose.yml` is set to a zeroed placeholder — intentional for local dev only, clearly commented
- `JWT_SECRET` in compose is also a dev-only placeholder with a comment to change it before any real use
