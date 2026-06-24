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

| Service  | URL                   |
| -------- | --------------------- |
| Backend  | http://localhost:3001 |
| Frontend | http://localhost:3000 |

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

---

## Branch Naming

Use one of these prefixes followed by a short, kebab-cased description:

| Prefix      | Use for                                     |
| ----------- | ------------------------------------------- |
| `feat/`     | New features                                |
| `fix/`      | Bug fixes                                   |
| `docs/`     | Documentation-only changes                  |
| `chore/`    | Dependency bumps, tooling, config           |
| `refactor/` | Code restructuring without behaviour change |
| `test/`     | Adding or fixing tests                      |

Examples:

```
feat/gdpr-data-export
fix/refresh-token-expiry
docs/security-guide
```

---

## Code Style

The project uses ESLint and Prettier. Run the formatter and linter before pushing:

```bash
npm run format   # applies Prettier
npm run lint     # ESLint check
```

Key conventions:

- ES modules (`import`/`export`) throughout — no `require()`.
- Async/await preferred over `.then()` chains.
- No unused variables; `_` prefix for intentionally unused parameters.
- Keep functions small and single-purpose; avoid deeply nested callbacks.

---

## Commit Message Format

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <short summary>

[optional body — explain *why*, not *what*]

[optional footer — e.g. Closes #123]
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`.

Examples:

```
feat(auth): add GDPR data-export endpoint

Implements Article 15 right-of-access requirement.
Closes #503

fix(compliance): filter MEDIUM alerts from SAR reports
```

---

## Good First Issues

Issues labelled **`good first issue`** are well-scoped, self-contained tasks with clear acceptance criteria — ideal if you are new to the codebase.

To find them: go to [Issues](https://github.com/Ethereal-Future/FuTuRe/issues?q=is%3Aopen+label%3A%22good+first+issue%22) and filter by the `good first issue` label.

Before starting:

1. Comment on the issue to let others know you are working on it.
2. Ask any clarifying questions in the issue thread before writing code.
3. Keep the PR focused on the acceptance criteria — avoid unrelated refactors.

---

## GitHub Actions Pinning Policy

All `uses:` references in `.github/workflows/` **must** be pinned to a full commit SHA rather than a mutable version tag.

**Why:** A tag like `actions/checkout@v4` can be silently moved to a different commit by the action author (intentionally or after a supply-chain compromise). If that commit contains malicious code it will execute with access to repository secrets. A pinned SHA is immutable — the exact code that was reviewed is the exact code that runs.

### Adding a new action

1. Find the commit SHA for the version you want:
   ```bash
   # Using gh CLI
   gh api repos/<owner>/<action>/git/refs/tags/<tag> --jq '.object.sha'
   # If the tag points to an annotated tag object, resolve it:
   gh api repos/<owner>/<action>/git/tags/<sha> --jq '.object.sha'
   ```
2. Use the SHA in the workflow file with a human-readable comment:
   ```yaml
   uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
   ```
3. Dependabot (configured in `.github/dependabot.yml`) will open PRs automatically when a new version is available, updating the SHA to the latest commit for the tag. Review the tag comment to confirm the version before merging.

### Reviewing a Dependabot action bump PR

- Check the action's CHANGELOG / release notes for the new version.
- Confirm the SHA in the PR matches the tag it claims (spot-check via `gh api`).
- Never approve a SHA update without verifying the tag it corresponds to.

---

## Dependency Vulnerability Management

### Automated scanning

`npm audit --audit-level=high` runs as a blocking CI step in both `test.yml` and `security-pipeline.yml` (covering the root workspace, `backend/`, and `frontend/`). A PR cannot merge if any **high** or **critical** vulnerability is present in the dependency tree.

Dependabot is configured (`.github/dependabot.yml`) to open weekly PRs for outdated packages across all three npm contexts and for GitHub Actions. These PRs are labelled `dependencies` and follow the normal review process.

### Reviewing a vulnerability alert

1. Run `npm audit` locally to read the full advisory:
   ```bash
   npm audit
   cd backend && npm audit
   cd frontend && npm audit
   ```
2. Check the advisory severity, affected versions, and whether a patched version exists.
3. If a fix is available, update:
   ```bash
   npm audit fix                  # safe semver-compatible fixes
   npm audit fix --force          # major-version bumps (review breaking changes first)
   ```
4. If no upstream fix exists yet, assess exploitability in context. If the vulnerable code path is not reachable (e.g., a dev-only package never executed in production), document the exception in a comment on the advisory issue and set a reminder to re-evaluate in 30 days.

### Applying a security patch

1. Create a branch: `chore/fix-<package>-vuln`.
2. Update the dependency and run the full test suite:
   ```bash
   npm run test:coverage
   npm audit --audit-level=high
   ```
3. Open a PR with the advisory ID in the description (e.g., `Fixes GHSA-xxxx-xxxx-xxxx`).
4. Request review from at least one maintainer — security patches are treated as priority reviews.
5. Merge as soon as approved; do not batch security fixes with unrelated changes.

### Accepting a Dependabot PR

- Check the changelog / release notes for breaking changes before approving.
- Run `npm run test:coverage` against the branch locally if the package is a critical runtime dependency.
- If the update introduces a breaking change that cannot be resolved immediately, close the PR with a comment explaining the blocker and open a tracking issue.
