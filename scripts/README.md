# Scripts

Utility scripts for the FuTuRe repo. All are run from the repo root unless noted otherwise.

There's no repo-wide `--help` convention — most scripts read their own top-of-file comment for usage, and flags are parsed manually (see each entry below for the flags a given script accepts).

## check-i18n-strings.mjs

**Purpose:** Statically scans JSX files under `frontend/src/components` for user-facing string literals that aren't routed through the i18n module (`t('key')`, `i18n.t('key')`, etc.), so new hardcoded strings are caught before merge instead of accumulating silently. Part of [#805](https://github.com/Ethereal-Future/FuTuRe/issues/805).

**Runs in:** CI (`.github/workflows/ci.yml`, "Lint & Format" job, via `npm run lint:i18n`) and locally.

**Env vars:** none.

**Usage:**

```bash
npm run lint:i18n
# equivalent to:
node scripts/check-i18n-strings.mjs [--dir <path>] [--json] [--write-baseline]
```

- `--dir <path>` — directory to scan (default `frontend/src/components`).
- `--json` — machine-readable output.
- `--write-baseline` — regenerate `scripts/i18n-strings-baseline.json` from the current findings.

The script fails (exit 1) only on findings *not already* in `scripts/i18n-strings-baseline.json` — this lets the existing backlog of hardcoded strings be paid down incrementally while still blocking new ones. If a flagged string genuinely isn't user-facing copy, run with `--write-baseline` to accept it rather than editing the baseline JSON by hand.

## cleanup-test-artifacts.mjs

**Purpose:** Deletes generated test report files (`test-reports/report-*.json` / `.html`) older than a retention window, to keep the working tree from accumulating stale reports.

**Runs in:** Locally only. `npm run test:cleanup` exists in `package.json` but is not currently invoked by any CI workflow — CI uploads reports as GitHub Actions artifacts (with their own `retention-days`) instead of relying on this script.

**Env vars:** none.

**Usage:**

```bash
npm run test:cleanup
# equivalent to:
node scripts/cleanup-test-artifacts.mjs --days 30 [--dry-run]
```

- `--days <n>` — retention window in days (default 30).
- `--dry-run` — print what would be deleted without deleting.

## create-issues.mjs

**Purpose:** Bulk-creates GitHub issues from a local `ISSUES.md` file at the repo root. Each issue block is expected in the form:

```
### #123 — Issue title
**Labels:** `label-one` `label-two`

Issue body...
---
```

**Runs in:** Manual only — not referenced by any CI workflow or `package.json` script.

**Requires:** the [`gh` CLI](https://cli.github.com/), authenticated (`gh auth login` or `GH_TOKEN`/`GITHUB_TOKEN` in the environment), with permission to create issues on the target repo. It shells out to `gh issue create` per issue and falls back to retrying without labels if a label doesn't exist yet in the repo.

**Env vars:** none read directly by the script — `gh` picks up `GH_TOKEN`/`GITHUB_TOKEN` itself if set.

**Usage:**

```bash
node scripts/create-issues.mjs
```

The target repo (`Ethereal-Future/FuTuRe`) is hardcoded at the top of the file — update it there if you need to point it elsewhere.

> **Note:** this script reads `ISSUES.md`, which does not currently exist in the repo. Running it as-is will fail at the `readFileSync` call. It's kept as a one-off bulk-import tool for whoever is next drafting a batch of issues from a markdown draft — treat it as scaffolding, not a script with a standing input file.

## fund-testnet-account.sh

**Purpose:** Funds a Stellar testnet account with 10,000 test XLM via Friendbot. See [README.md § Testnet Setup](../README.md#testnet-setup) for the full testnet workflow.

**Runs in:** Manual only.

**Env vars:** none.

**Usage:**

```bash
bash scripts/fund-testnet-account.sh <STELLAR_PUBLIC_KEY>
# e.g.
bash scripts/fund-testnet-account.sh GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZWM9CQJHD9QDNHXHXN
```

Validates the key looks like a Stellar public key (`G` + 55 base32 chars) before calling Friendbot.

## pii-scan.mjs

**Purpose:** Scans all git-tracked files for accidentally committed secrets/PII — Stellar secret keys (`S...`), JWTs, and email addresses outside the allowlisted example domains (`example.com`/`.org`/`.net`). This is the primary guard against real credentials or personal data landing in tests, fixtures, docs, or reports in this remittance/compliance-sensitive codebase.

**What counts as a violation:** any match of the three patterns above in a tracked file with an allowed extension (`.js`, `.jsx`, `.ts`, `.tsx`, `.json`, `.md`, `.yml`, `.yaml`, `.txt`, `.env`, `.html`, `.css`), except:
- files in the `SKIP_EXACT` allowlist at the top of the script (documentation with intentional example values, tests that use deliberately fake/generated keys and JWTs),
- `node_modules/`, `dist/`, `coverage/`, and `.git/`,
- paths matching `PII_SCAN_IGNORE` (see below).

Findings are redacted in output (e.g. `SXXX…XXXX`) — the report never prints the raw secret.

**Runs in:** CI (`.github/workflows/security-pipeline.yml`, "Secret Scanning" job) **and** locally — it's also the first step of `npm test` (`npm run test:privacy && vitest run`), so it runs on every local `npm test` invocation, not just in CI.

**Env vars:**
- `PII_SCAN_IGNORE` — comma-separated path substrings to exclude, for temporary local exceptions.

**Usage:**

```bash
npm run test:privacy
# equivalent to:
node scripts/pii-scan.mjs
```

Exits non-zero if any finding is present — this fails both the CI job and any local `npm test` run.

## test-migrations.js

**Purpose:** Smoke-tests the migration framework itself (`backend/src/migrations/framework.js`) against a small set of inline sample migrations and an in-memory mock DB (not a real database connection): applies all migrations, verifies the resulting schema, rolls everything back, and verifies the schema is clean again.

**Runs in:** Manual only — not referenced by any CI workflow or `package.json` script. This is distinct from `backend`'s Prisma migrations (see [CONTRIBUTING.md § Run database migrations](../CONTRIBUTING.md#4-run-database-migrations) and [docs/runbook.md § DB Migration Rollback](../docs/runbook.md)); it doesn't touch Postgres or `prisma/schema.prisma` at all.

**Env vars:** none.

**Usage:**

```bash
node scripts/test-migrations.js
```

## Other i18n scripts (undocumented in the originating issue, kept for completeness)

Three more scripts live in `scripts/` alongside the ones above. None are wired into `package.json` or CI — they were written as one-off aids for the locale-parity work referenced in [CONTRIBUTING.md § Code Style](../CONTRIBUTING.md#code-style) (RTL/logical-properties conventions) and `frontend/src/i18n`.

- **check-locale-parity.js** — compares every file in `frontend/src/i18n/locales/` against `en.json` and reports missing/extra keys. Run with `node scripts/check-locale-parity.js`. This duplicates part of what a locale-parity CI check would do; if one is added, prefer wiring this script in rather than reimplementing it.
- **list-locale-diff.js** — prints missing keys for `es.json`/`he.json` and extra keys for `ar.json` against `en.json`. The three target locales are hardcoded. Run with `node scripts/list-locale-diff.js`.
- **fix-ar-locale.js** — one-time cleanup script that deletes keys from `ar.json` not present in `en.json`, mutating the file in place. Run with `node scripts/fix-ar-locale.js`.

`list-locale-diff.js` and `fix-ar-locale.js` look like one-off tools written for a specific past cleanup (their locale lists are hardcoded rather than derived from the locales directory) rather than general-purpose, reusable tooling — flagging here per the parent issue's request rather than deleting them unilaterally.
