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

> **Resource limits:** `docker-compose.yml` and `docker-compose.dev.yml` set
> `deploy.resources.limits` on every service (the `backend` limits intentionally
> mirror the production ECS Fargate task sizing in `infra/variables.tf`). If
> containers are being OOM-killed or throttled on your machine, raise the
> relevant `limits.cpus`/`limits.memory` values in your local checkout — see
> the rationale comment at the top of `docker-compose.yml`.

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

## Testing

This section is the complete reference for writing, running, and reasoning about tests in this project. A new contributor should be able to follow it from top to bottom without prior knowledge of the test setup.

> **Day-one task:** Before you write any code, run all three test suites locally and confirm they pass. This validates your environment and gives you a baseline to compare against.

### Quick-reference command table

| Suite                           | Command                                  | When to use                                     |
| ------------------------------- | ---------------------------------------- | ----------------------------------------------- |
| Unit + integration (single run) | `npm run test:coverage`                  | Before every PR                                 |
| Unit + integration (watch mode) | `npm run test:watch`                     | During development                              |
| Backend tests only              | `npm run test --workspace=backend`       | When changing backend code                      |
| DB integration tests            | `npm run test:db --workspace=backend`    | When changing Prisma schema or queries          |
| E2E tests (headless)            | `npx playwright test`                    | Before every PR, from `e2e/` directory          |
| E2E tests (headed — visual)     | `npx playwright test --headed`           | Debugging a failing E2E test                    |
| E2E tests (one browser)         | `npx playwright test --project=chromium` | Faster local iteration                          |
| Mutation tests                  | `npm run test:mutation`                  | When adding new unit tests or utility functions |
| Property-based tests            | `npm run test:property`                  | Included in `npm run test:coverage`             |
| Contract tests                  | `npm run test:contracts`                 | When changing API request/response shapes       |

---

### Test stack overview

The project uses three distinct testing frameworks, each with a specific role.

#### Vitest — unit and integration tests

[Vitest](https://vitest.dev/) covers all unit and integration tests across the frontend and backend. Use Vitest for:

- Pure functions (validators, formatters, utilities)
- Service layer logic
- React component rendering and interactions (`@testing-library/react`)
- Backend route handlers with a mocked or in-process Express app
- Database integration tests against a real PostgreSQL instance

**Do not** use Vitest for anything that requires a real browser (use Playwright instead).

Configuration: `vitest.config.js` (root), `vitest.mutation.config.js` (mutation testing), `vitest.property.config.js` (property tests), `vitest.contracts.config.js` (contract tests).

Coverage thresholds (enforced in CI):

| Metric     | Threshold |
| ---------- | --------- |
| Lines      | 80%       |
| Functions  | 80%       |
| Branches   | 75%       |
| Statements | 80%       |

#### Playwright — end-to-end tests

[Playwright](https://playwright.dev/) drives a real browser to test complete user flows. Use Playwright for:

- Multi-step user journeys (registration → onboarding → dashboard)
- Anything that depends on browser APIs (cookies, `localStorage`, clipboard)
- Cross-browser compatibility (Chromium, Firefox, WebKit, mobile viewports)
- Visual regression (`@visual` tag)

**Do not** write Playwright tests for logic that Vitest can cover. A Playwright test is 10–50× slower than a Vitest test.

Configuration: `e2e/playwright.config.js`.

#### Stryker — mutation testing

[Stryker](https://stryker-mutator.io/) measures test quality by introducing small deliberate bugs (mutations) into the source code and checking whether the test suite catches them. A high line-coverage figure can hide weak assertions — Stryker makes the quality of assertions visible.

Use the mutation score as a signal, not a hard constraint:

| Score        | Meaning                                |
| ------------ | -------------------------------------- |
| ≥ 80 (high)  | Acceptable — assertions are meaningful |
| 60–79 (low)  | Flag for improvement before merging    |
| < 50 (break) | CI fails — too many mutations survive  |

Mutation testing targets `frontend/src/utils/*.js` and `backend/src/services/*.js`. It does not run on every PR by default (it is slow); it runs in CI on the `test:mutation:ci` pipeline job.

---

### Prerequisite setup

#### 1. Install Node.js 20 and npm 10

```bash
nvm use 20
node --version   # v20.x.x
npm --version    # 10.x.x
```

#### 2. Install all dependencies

```bash
npm install           # from the repo root
```

#### 3. Start PostgreSQL

```bash
docker compose up db -d
```

This is required for DB integration tests (`test:db`) and for any test that uses Prisma against a real database.

#### 4. Configure the backend environment

```bash
cd backend
cp .env.example .env
```

For tests, the minimum required variables are:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/future_remittance
JWT_SECRET=any-string-is-fine-for-testing
STREAM_SECRET_ENCRYPTION_KEY=<32-byte hex — see comment in .env.example>
```

A `.env.test` file is already present in `backend/` with safe test defaults. Vitest picks it up automatically when running `npm run test`.

#### 5. Run database migrations

```bash
cd backend
npx prisma migrate deploy
```

#### 6. Install Playwright browser binaries

The Playwright binaries are not bundled with `npm install`. Install them once:

```bash
cd e2e
npm install                    # installs Playwright itself
npx playwright install         # downloads browser binaries (~300 MB)
npx playwright install-deps    # installs OS-level dependencies (Linux only)
```

Expected output from `npx playwright install`:

```
Downloading Chromium 123.0.6312.86 ...
Chromium 123.0.6312.86 downloaded to ~/.cache/ms-playwright/...
Downloading Firefox 124.0 ...
...
```

#### 7. (Optional) Install k6 for load tests

```bash
# macOS
brew install k6

# Linux
sudo apt-get install k6

# Windows
choco install k6
```

---

### Writing unit tests

#### File location and naming

| Code being tested                      | Test file location                          | Example    |
| -------------------------------------- | ------------------------------------------- | ---------- |
| `backend/src/auth/tokens.js`           | `backend/tests/auth.tokens.test.js`         | ✔ existing |
| `frontend/src/utils/validateAmount.js` | `frontend/src/utils/validateAmount.test.js` | ✔ existing |
| `frontend/src/components/Button.jsx`   | `frontend/src/components/Button.test.jsx`   | ✔ existing |

Test files must end in `.test.js`, `.test.jsx`, `.spec.js`, or `.spec.jsx`.

#### Conventions

- One `describe` block per module or function under test.
- One `it` / `test` per behaviour, not per line of source code.
- Test description reads as a sentence: `it('returns null when the amount is zero')`.
- Arrange–Act–Assert structure: set up data, call the function, assert the result.
- Use `beforeEach` for per-test setup. Avoid shared mutable state across tests.
- Prefer real values over mocks unless the dependency is a network call, database, or clock.

#### Annotated example — `backend/tests/auth.tokens.test.js`

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { signAccessToken, verifyToken, signRefreshToken } from '../src/auth/tokens.js';
import { resetConfig } from '../src/config/env.js';

describe('JWT Tokens', () => {
  // ── Setup ──────────────────────────────────────────────────────────────────
  // Reset the config singleton and set a deterministic JWT_SECRET before each
  // test so tests do not depend on each other's environment state.
  beforeEach(() => {
    resetConfig();
    process.env.JWT_SECRET = 'test-secret-key-12345';
  });

  // ── Happy path ─────────────────────────────────────────────────────────────
  it('signs and verifies an access token', () => {
    const payload = { userId: 'user-123', role: 'admin' };

    // Act — produce a token from a known payload
    const token = signAccessToken(payload);

    // Assert — the token is a non-empty string
    expect(token).toBeDefined();

    // Act — verify the token and unpack the payload
    const verified = verifyToken(token);

    // Assert — the original claims are present
    expect(verified.userId).toBe('user-123');
    expect(verified.role).toBe('admin');
  });

  it('signs and verifies a refresh token', () => {
    const payload = { userId: 'user-456' };
    const token = signRefreshToken(payload);
    const verified = verifyToken(token);
    expect(verified.userId).toBe('user-456');
  });

  // ── Error path ─────────────────────────────────────────────────────────────
  // Test the unhappy path explicitly. This verifies that the error is thrown
  // rather than silently returning undefined or a bad token.
  it('throws when JWT_SECRET is not configured', () => {
    resetConfig();
    delete process.env.JWT_SECRET;

    expect(() => {
      signAccessToken({ userId: 'user' });
    }).toThrow('JWT_SECRET is not configured');
  });
});
```

**Key things to notice:**

1. `beforeEach` resets global state — tests that mutate `process.env` or a singleton must clean up.
2. Happy path and error path are both tested.
3. Each `it` has a single, focused assertion goal. Multi-assertion tests are fine when all assertions test the same behaviour.
4. No mocks were needed here because `signAccessToken` is a pure function given a stable `JWT_SECRET`.

#### Shared fixtures and factories

Shared test helpers live in `testing/` at the repo root and in `backend/tests/helpers/`. Import from there rather than duplicating setup logic:

```javascript
import { createTestUser, createTestSession } from '../helpers/factories.js';
```

---

### Writing E2E tests

#### Prerequisite: start the app

The Playwright config starts `npm run dev` automatically when you run tests (`webServer` in `e2e/playwright.config.js`). If a server is already running on port 3000, Playwright will reuse it.

```bash
# run all e2e tests (from repo root)
cd e2e
npx playwright test

# run headed — opens a browser window you can watch
npx playwright test --headed

# run a single file
npx playwright test tests/onboarding.spec.js

# run a single test by title
npx playwright test --grep "shows public key"

# run on one browser only (faster during development)
npx playwright test --project=chromium
```

**Expected clean-run output:**

```
Running 8 tests using 1 worker

  ✓ Registration › shows confirmation or redirects to keypair setup (1.3s)
  ✓ Registration › shows error when email is already registered (2.1s)
  ...

  8 passed (12s)
```

#### File location and naming

All E2E tests live in `e2e/tests/`. Name files after the user flow they cover: `onboarding.spec.js`, `payment.spec.js`, `settings.spec.js`.

#### Page object pattern

For any page visited by more than one test, extract selectors and actions into a page object class. Store page objects in `e2e/pages/`:

```javascript
// e2e/pages/LoginPage.js
export class LoginPage {
  constructor(page) {
    this.page = page;
    this.emailInput = page.locator('[data-testid="email"]');
    this.passwordInput = page.locator('[data-testid="password"]');
    this.submitButton = page.locator('[data-testid="signup-btn"]');
    this.errorMessage = page.locator('[data-testid="signup-error"]');
  }

  async goto() {
    await this.page.goto('/signup');
  }

  async fillAndSubmit(email, password) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
```

Then use it in a test:

```javascript
import { LoginPage } from '../pages/LoginPage.js';

test('shows error for duplicate email', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.fillAndSubmit('alice@example.com', 'Str0ngPass!');
  // ...
});
```

#### Handling authentication in E2E tests

Use `data-testid` attributes for selectors — never CSS classes or element tags, which change with styling refactors. The existing tests in `e2e/tests/onboarding.spec.js` follow this pattern.

To avoid re-authenticating in every test, use Playwright's [storageState](https://playwright.dev/docs/auth) to save a logged-in session:

```javascript
// e2e/auth.setup.js
import { test as setup } from '@playwright/test';

setup('authenticate', async ({ page }) => {
  await page.goto('/signup');
  await page.fill('[data-testid="email"]', 'test@example.com');
  await page.fill('[data-testid="password"]', 'Str0ngPass!');
  await page.click('[data-testid="signup-btn"]');
  await page.waitForURL(/\/dashboard/);
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
```

#### Annotated example — `e2e/tests/onboarding.spec.js`

```javascript
import { test, expect } from '@playwright/test';

// Helper to generate a unique email per test run, preventing conflicts
// when tests run in parallel or are retried.
function uniqueEmail() {
  return `test+${Date.now()}@example.com`;
}

const STRONG_PASSWORD = 'Str0ngPass!word';

test.beforeEach(async ({ page, context }) => {
  // Start each test with a clean browser state
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());

  // Intercept Friendbot calls so tests do not depend on the live Stellar testnet.
  // The route mock returns a fixed successful response, making tests fast and deterministic.
  await page.route('**/friendbot**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ successful: true, hash: 'b'.repeat(64) }),
    });
  });
});

test('shows confirmation or redirects to keypair setup after registration', async ({ page }) => {
  const email = uniqueEmail();

  // Navigate to the signup page
  await page.goto('/signup');
  await page.fill('[data-testid="email"]', email);
  await page.fill('[data-testid="password"]', STRONG_PASSWORD);
  await page.click('[data-testid="signup-btn"]');

  // Assert — either the email-verification message or keypair setup is visible.
  // Both are valid post-registration states depending on server configuration.
  await expect(
    page.locator('[data-testid="verify-message"], [data-testid="keypair-setup"]'),
  ).toBeVisible({ timeout: 10000 });
});
```

**Key things to notice:**

1. `beforeEach` clears all browser state — tests are fully isolated.
2. Network calls to external services are mocked with `page.route(...)` — tests are deterministic.
3. Selectors use `data-testid` — resilient to HTML restructuring.
4. The timeout on `toBeVisible` accounts for async navigation without relying on `waitForTimeout`.

#### CI behaviour for E2E tests

In CI (`process.env.CI` is set):

- `retries: 2` — a flaky test must fail 3 times in a row before CI marks it as failed.
- `workers: 1` — tests run sequentially to avoid port conflicts on shared runners.
- `forbidOnly: true` — `test.only` accidentally left in code causes CI to fail immediately.
- Reports are written to `e2e/test-reports/` (HTML, JSON, JUnit).

On a local machine, tests run in parallel across available CPUs and retries are disabled.

---

### Mutation testing

#### Running Stryker

```bash
# Run mutation testing (from the repo root)
npm run test:mutation
```

This takes several minutes. Stryker targets `frontend/src/utils/*.js` and `backend/src/services/*.js`.

Reports are written to `mutation-reports/`:

- `mutation-reports/mutation-report.html` — open in a browser for the full interactive report
- `mutation-reports/mutation-report.json` — machine-readable output for CI tracking

#### Interpreting the output

Stryker prints a summary to the terminal:

```
Mutation testing  [done] 2 minutes
Ran 312 tests across 48 mutants in 105 seconds.

All files
 File                          | % score | # killed | # survived | # no coverage | # error |
-------------------------------|---------|----------|------------|---------------|---------|
 validateAmount.js             |  91.67  |    11    |      1     |       0       |    0    |
 formatBalance.js              |   75.00 |     9    |      3     |       0       |    0    |
```

- **killed** — the mutation was caught by at least one test. ✔
- **survived** — the mutation was NOT caught. Your tests did not assert on this behaviour. Add a test that would fail if this code were wrong.
- **no coverage** — no test exercised the mutated line at all. Add a test for this code path.

#### Thresholds

| Threshold | Score | Consequence                                  |
| --------- | ----- | -------------------------------------------- |
| `high`    | 80    | Target — acceptable quality                  |
| `low`     | 60    | Warning — reviewer should request more tests |
| `break`   | 50    | CI hard-fails — PR cannot merge              |

#### Improving a low score

When a mutation survives, look at the mutant in the HTML report. Stryker shows you exactly what code it changed and which tests ran. Add an assertion that would catch the described change:

```javascript
// Surviving mutant: changed `>` to `>=` in validateAmount.js
// Add a boundary test:
it('rejects amount of exactly 0', () => {
  expect(validateAmount(0)).toBe(false);
});
```

---

### CI behaviour

| Event           | Jobs that run                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| Every PR        | `test` (Vitest + coverage), `lint`, `tsc --noEmit`, `npm audit --audit-level=high`, `e2e-tests` (Playwright) |
| Merge to `main` | All PR jobs + `security-pipeline`, `docker-scan`, `performance`                                              |
| Weekly schedule | `mutation-testing`, `backup-verification`, `dependency-updates`                                              |

#### When a CI job fails

1. Click the failing job in GitHub Actions to see the full log.
2. For Vitest failures: the log shows the test name, the expected vs received values, and a stack trace. Run the same test locally: `npx vitest run --reporter=verbose <file>`.
3. For Playwright failures: screenshots and videos of the failing test are uploaded as workflow artifacts. Download them from the Actions run summary.
4. For mutation testing failures: the `mutation-report.html` artifact shows exactly which mutants survived. Add tests for the surviving mutants.
5. For `npm audit` failures: run `npm audit` locally and follow the [Dependency Vulnerability Management](#dependency-vulnerability-management) section.

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
- [ ] If this PR adds, removes, or significantly changes a component, service, or data flow: update `docs/architecture.md` in the same PR

### First-day onboarding checklist

If you are new to this project, complete these tasks before writing any code:

- [ ] Install Node.js 20 and verify with `node --version`
- [ ] Clone the repo and run `npm install`
- [ ] Start PostgreSQL with `docker compose up db -d`
- [ ] Copy `backend/.env.example` to `backend/.env` and fill in required values
- [ ] Run `npm run test:coverage` and confirm all tests pass
- [ ] If contributing to frontend: run `cd e2e && npx playwright install` to download browser binaries
- [ ] Run the dev server with `npm run dev` and confirm both frontend and backend start
- [ ] Read the [Testing](#testing) section in this file

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
- All new CSS must use logical properties instead of physical directional ones, so layouts mirror correctly for RTL locales (Arabic, Hebrew). Use `margin-inline-start`/`margin-inline-end` instead of `margin-left`/`margin-right`, `padding-inline-start`/`padding-inline-end` instead of `padding-left`/`padding-right`, `text-align: start`/`end` instead of `left`/`right`, `border-inline-start`/`border-inline-end` instead of `border-left`/`border-right`, and `inset-inline-start`/`inset-inline-end` instead of positioning with `left`/`right`.

### JSDoc for Backend Services

Every exported function in `backend/src/services/` must have a JSDoc block with:

- A plain-English summary sentence.
- A `@param` entry for every parameter (name, type, description).
- A `@returns` tag describing the type and meaning of the return value.
- An `@throws` tag for any error conditions the function explicitly raises.
- An `@example` block for complex or non-obvious functions.

A one-line description is sufficient for simple utility functions — accuracy
matters more than verbosity. Internal/unexported helpers don't require JSDoc,
though documenting genuinely non-obvious ones is still encouraged. See any
file in `backend/src/services/` for the established style.

This isn't yet enforced by ESLint — see
[issue #815](https://github.com/Ethereal-Future/FuTuRe/issues/815) for the
tracked follow-up to add `eslint-plugin-jsdoc`'s `jsdoc/require-jsdoc` rule
scoped to this directory.

### Image Assets

New raster assets (PNG/JPG/WebP) must be provided at 1x, 2x, and 3x
resolution, named `name.png`, `name@2x.png`, `name@3x.png`, so they render
sharp on high-DPI (Retina and equivalent) displays instead of the browser
having to upscale the 1x file.

- In JSX, use `<ResponsiveImg src="/logo.png" alt="..." />`
  (`frontend/src/components/ResponsiveImg.jsx`) instead of a plain `<img>` —
  it derives the `srcset` density descriptors from the 1x path automatically.
- In CSS `background-image` declarations, build the value with
  `buildImageSet()` from `frontend/src/utils/responsiveImage.js`.
- Prefer SVG for logos/icons where possible — it's resolution-independent
  and sidesteps this requirement entirely.

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

---

## Renovate (Automated Dependency Updates — issue #773)

Renovate Bot is configured via `renovate.json` in the repository root. It automatically opens
PRs for outdated npm dependencies on a weekly schedule (every weekend) and immediately for
security advisories.

### What Renovate manages

| Package set                     | Behaviour                                           |
| ------------------------------- | --------------------------------------------------- |
| Minor + patch npm updates       | Grouped into a single PR per week                   |
| Security-flagged updates        | Separate PR opened immediately, labelled `security` |
| Major npm updates               | Separate PR per package, requires manual review     |
| GitHub Actions                  | Weekly SHA-pin update PR                            |
| Prisma (client + CLI + adapter) | Grouped together to keep versions in sync           |
| `@stellar/stellar-sdk`          | Pinned exact version — update manually with care    |
| Lock-file maintenance           | Monthly PR to refresh `package-lock.json`           |

### Reviewing a Renovate PR

1. Read the changelog / release notes linked in the PR body.
2. Check the CI status — all jobs must pass before merging.
3. For `@stellar/stellar-sdk` major bumps, test against the Stellar testnet before merging.
4. Merge Renovate PRs promptly — letting them accumulate defeats the purpose of automation.

### Renovate vs Dependabot

Both tools are active. Renovate handles richer grouping and scheduling; Dependabot remains as
a fallback for GitHub Actions SHA pinning if Renovate is unavailable. If both open a PR for the
same package, close the Dependabot one in favour of the Renovate PR.

---

## Docker Image Scanning (Trivy — issue #772)

Every pull request that touches `backend/` or `frontend/` source or Dockerfiles triggers a
Trivy image vulnerability scan (`.github/workflows/docker-scan.yml`). The scan also runs
nightly on `main` to catch newly published CVEs against already-merged images.

### Failure thresholds

The scan fails the pipeline on any **HIGH** (CVSS ≥ 7.0) or **CRITICAL** (CVSS ≥ 9.0) CVE
that has a known fix available. Unfixed CVEs are reported but do not block the pipeline.

### Suppressing a false positive

If a CVE is not exploitable in this deployment context (e.g. a vulnerable code path in a
library is never reached, or the CVE applies only to a configuration we don't use):

1. Open an issue documenting why the CVE is not exploitable and get approval from a maintainer.
2. Add the CVE ID to `.trivyignore` with a **dated comment** and a **review date ≤ 90 days**:

   ```
   CVE-YYYY-NNNNN
   # Reason: <explanation>. Review by: YYYY-MM-DD.
   ```

3. Re-evaluate the suppression on the review date. If a fix is now available, remove the
   suppression and update the base image.

### Keeping base images current

Base image tags (`node:20-alpine`, `nginx:alpine`) should be updated regularly. Renovate will
open PRs for Dockerfile base image updates when the SHA-pinned digest becomes outdated.

---

## TypeScript Migration (issue #771)

The backend is being incrementally migrated to TypeScript. The migration plan is documented
in [`docs/typescript-migration.md`](docs/typescript-migration.md).

### Working with the mixed JS/TS codebase

- `backend/tsconfig.json` is configured with `allowJs: true` and `noEmit: true`.
- `tsc --noEmit` runs in CI as part of the `lint` job — all `.ts` files must compile cleanly.
- Migrated files live at their original path with a `.ts` extension (e.g. `stellar.ts`).
- The original `.js` file is retained until all callers are updated, then removed.

### Adding a new backend file

- New files should be written in TypeScript (`.ts`), not JavaScript.
- Run `npx tsc --noEmit` locally before pushing to confirm the file compiles.
- Avoid `@ts-ignore` — fix the type. If a third-party type is wrong, use a narrow cast with a comment.

### Migrating an existing JS file

1. Copy the JS file to a `.ts` file of the same name.
2. Add type annotations to all function parameters and return types.
3. Fix any `strict` errors — no implicit `any`.
4. Open a PR with the label `typescript-migration`.
5. The PR must pass `tsc --noEmit` and all existing tests without modification.
