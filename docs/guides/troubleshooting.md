# Local Development Troubleshooting

Fixes for common failures when setting up or running FuTuRe locally. This guide is scoped to **local development environment problems** — for production operational incidents, see [`docs/runbook.md`](../runbook.md) and [`docs/runbooks/`](../runbooks/README.md) instead.

If you hit something not covered here, please add it once you've found the fix — see the acceptance criteria in issue #1012.

---

## Docker / ports

| Symptom | Cause | Fix |
| --- | --- | --- |
| `docker compose up` fails with `Bind for 0.0.0.0:5432 failed: port is already allocated` (or `3000`/`3001`/`6379`) | `docker-compose.yml` binds ports `3000`, `3001`, `5432`, and `6379` on the host. One is already taken by a natively-installed PostgreSQL/Redis, another dev server, or a previous `docker compose` run that wasn't stopped. | Find and stop whatever holds the port (`lsof -i :5432` on macOS/Linux), or stop native Postgres/Redis services. If you need to keep the local service running, copy `docker-compose.override.yml.example` to `docker-compose.override.yml` (git-ignored) and remap the conflicting port there — see [Local overrides](../../README.md#local-overrides) in the README. |
| Containers get OOM-killed or throttled, especially `backend` under load | `docker-compose.yml` sets `deploy.resources.limits` per service (0.5 vCPU / 1024 MiB for `backend`, mirroring the production ECS Fargate sizing in `infra/variables.tf`) to catch memory-pressure bugs locally. On a resource-constrained machine, or with an IDE and other tooling also running, these limits can be too tight. | Raise the relevant `limits.cpus` / `limits.memory` values in your local checkout of `docker-compose.yml` — see the rationale comment at the top of the file and the note in [CONTRIBUTING.md's Local Setup](../../CONTRIBUTING.md#local-setup). |
| `docker compose up` starts but the backend keeps restarting, logs show it retrying the database connection | `backend` has `depends_on: postgres: condition: service_healthy`, but if Postgres's healthcheck (`pg_isready`) is slow on first boot (fresh volume, slow disk), the backend can start before it's truly ready. | This is usually transient — Docker will keep restarting `backend` per `restart: unless-stopped` until Postgres reports healthy. If it doesn't recover after ~30s, check `docker compose logs postgres` for a crash rather than a slow start. |
| `docker compose up db -d` fails with `no such service: db` | The database service in the root `docker-compose.yml` is named `postgres`, not `db` — a `db` service only exists in `docker-compose.test.yml` (used for CI test databases). Easy to guess wrong if you're used to other projects' naming. | Use `docker compose up postgres -d` against the default compose file — this is what `CONTRIBUTING.md` now uses. |

## Database / Prisma

| Symptom | Cause | Fix |
| --- | --- | --- |
| `npx prisma migrate deploy` fails with `P3005` — *"The database schema is not empty"* | The target database already has tables that Prisma's migration history doesn't know about — typically a database that was created some other way (a stale volume from an old schema, or a DB shared with another checkout). | For **local dev data you don't need to keep**, wipe the volume and start clean: `docker compose down -v` (from the repo root — this deletes the Postgres volume, per the README's [Stop](../../README.md#stop) section), then `docker compose up postgres -d` and `npx prisma migrate deploy` again. If you need to keep the data, baseline it instead: mark existing migrations as already applied with `npx prisma migrate resolve --applied <migration_name>` for each migration under `backend/prisma/migrations/`. |
| Backend / Prisma commands fail with `Can't reach database server at localhost:5432` (`ECONNREFUSED`) | Postgres isn't running, or `DATABASE_URL` in `backend/.env` points somewhere else. | Start it with `docker compose up postgres -d` (from the repo root), and confirm `DATABASE_URL` in `backend/.env` matches the Docker Compose credentials: `postgresql://future_admin:dev_password@localhost:5432/future_remittance`. |
| After changing `STREAM_SECRET_ENCRYPTION_KEY`, payment streaming throws `Unsupported state or unable to authenticate data` when reading an existing stream | Stream sender secrets are encrypted at rest (AES-256-GCM, key derived from `STREAM_SECRET_ENCRYPTION_KEY` — see `backend/src/config/secrets.js`). Changing the key after secrets were already encrypted with the old one makes them undecryptable — this is authenticated encryption doing its job, not a bug. | For local dev, the simplest fix is to drop any `PaymentStream` rows created under the old key (`docker compose down -v` if you don't need other local data, or delete the affected rows directly). In a real deployment, re-encrypt existing secrets with `scripts/rotate-stream-key.js` *before* removing the old key — see the rotation note in [`backend/CONFIGURATION.md`](../../backend/CONFIGURATION.md). |
| `npm run test:db --workspace=backend` fails immediately with a connection error | DB integration tests need a real, running PostgreSQL instance — they don't mock the database. | Run `docker compose up postgres -d` first, per [CONTRIBUTING.md's Prerequisite setup](../../CONTRIBUTING.md#prerequisite-setup). |

## Stellar testnet

| Symptom | Cause | Fix |
| --- | --- | --- |
| Account creation fails with `Friendbot funding failed: 429 ...` (or the app's "Create Account" button errors out) | Friendbot rate-limits repeated funding requests from the same IP, which is common when iterating quickly during development or running E2E tests against the live network. | Wait a minute and retry — `bash scripts/fund-testnet-account.sh <PUBLIC_KEY>` reports the exact HTTP status Friendbot returned. For repeated local runs, prefer mocking Friendbot instead of hitting the live service — see how `e2e/tests/onboarding.spec.js` intercepts `**/friendbot**` with `page.route()` in [CONTRIBUTING.md's E2E example](../../CONTRIBUTING.md#annotated-example--e2etestsonboardingspecjs). |
| Friendbot funding or Horizon calls fail with `400`/`503`, or previously-funded accounts show a zero balance, with no config changes on your end | The Stellar testnet is wiped roughly every three months (see [Testnet Limitations](../../README.md#testnet-limitations) in the README) — all accounts, balances, and history are deleted network-wide. | Re-fund affected accounts after the reset: `bash scripts/fund-testnet-account.sh <PUBLIC_KEY>`. There's no local fix — this is expected testnet behavior, not an environment problem. |
| Horizon calls unrelated to Friendbot start failing (balance checks, submitting payments) | The public testnet Horizon instance (`https://horizon-testnet.stellar.org`) itself is occasionally degraded, independent of your local setup. | Check [Stellar's public status page](https://dashboard.stellar.org) before debugging your own config further; see also [`docs/runbooks/horizon-outage.md`](../runbooks/horizon-outage.md) for how this is handled in production. |

## npm / workspaces

| Symptom | Cause | Fix |
| --- | --- | --- |
| After switching branches, `npm run dev` or tests fail with `Cannot find module '...'` or unrelated-looking errors from a package you didn't touch | This is an npm-workspaces monorepo (root `package.json` plus `backend/` and `frontend/`). Switching branches can leave `node_modules` or `package-lock.json` out of sync with the new branch's dependencies. | From the repo root: `rm -rf node_modules backend/node_modules frontend/node_modules package-lock.json && npm install`. This reinstalls all three workspaces from a clean lockfile. |
| `npm install` at the repo root fails or hangs on the `prepare` script (`husky`) | The root `package.json`'s `"prepare": "husky"` script installs git hooks, which requires a `.git` directory. This fails if you're working from a downloaded zip/tarball instead of a real git clone. | Clone the repository with `git clone` rather than downloading a source archive, per [CONTRIBUTING.md's Local Setup](../../CONTRIBUTING.md#1-clone-and-install). |

## Environment variables

| Symptom | Cause | Fix |
| --- | --- | --- |
| Backend fails to start with `Missing required environment variables: STREAM_SECRET_ENCRYPTION_KEY, DATABASE_URL` (or just one of them) | These two variables are validated as required on every startup, in every environment (`validateRequiredSecrets()` in `backend/src/config/env.js`) — there is no dev-mode default. | Copy `backend/.env.example` to `backend/.env` and set both. Generate `STREAM_SECRET_ENCRYPTION_KEY` with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — see the [Quick Start](../../backend/CONFIGURATION.md#quick-start-minimum-required-variables) in `backend/CONFIGURATION.md`. |
| Backend refuses to start in staging/production with `JWT_SECRET must not be the default value in production or staging` | `JWT_SECRET` silently defaults to the literal string `secret` when unset in development, but that default is explicitly rejected once `APP_ENV` is `production` or `staging`. | Set `JWT_SECRET` to a strong random value in `backend/.env.staging` / your production environment — never reuse the dev default. |
| Backend refuses to start in staging/production with `ALLOWED_ORIGINS is required in production and staging` | `ALLOWED_ORIGINS` has a permissive localhost default in development only; it's required once `APP_ENV` is `production` or `staging`, per `backend/src/config/env.js`. | Set `ALLOWED_ORIGINS` to your actual frontend origin(s) — see the [CORS](../../backend/CONFIGURATION.md#cors) section of `backend/CONFIGURATION.md`. |
| Unsure whether to copy `backend/.env.example` or `backend/env.example.txt` | Both files exist in `backend/`; `README.md` and `CONTRIBUTING.md` reference `.env.example`, while `backend/CONFIGURATION.md`'s Quick Start references `env.example.txt`. They document an overlapping but not identical set of variables. | Use `backend/.env.example` — it's the one referenced by the setup steps in the root `README.md` and `CONTRIBUTING.md`. Cross-check any variable you're unsure about against the full reference table in `backend/CONFIGURATION.md`. |

## See also

- [`docs/GLOSSARY.md`](../GLOSSARY.md) — definitions for the Stellar and compliance terms used above
- [`backend/CONFIGURATION.md`](../../backend/CONFIGURATION.md) — full environment variable reference
- [`docs/runbook.md`](../runbook.md) / [`docs/runbooks/`](../runbooks/README.md) — production incident response (not local dev)
