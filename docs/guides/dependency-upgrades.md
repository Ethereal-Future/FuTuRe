# Manual Dependency Upgrade Guide

Renovate and Dependabot handle routine minor/patch updates automatically (see [CONTRIBUTING.md § Renovate](../../CONTRIBUTING.md#renovate-automated-dependency-updates--issue-773) and [§ Dependency Vulnerability Management](../../CONTRIBUTING.md#dependency-vulnerability-management)). This guide is scoped to the manual verification steps automation *can't* cover: major-version bumps and the packages `renovate.json` deliberately pins or groups for manual review.

## General major-upgrade checklist

Apply this to any major-version bump, not just the packages below:

1. **Read the changelog / release notes** for every version between the current pin and the target — not just the target version's notes, since intermediate majors can each carry breaking changes.
2. **Grep the codebase for the package's API surface** to gauge blast radius before upgrading (e.g. `grep -rn "from '@stellar/stellar-sdk'"`).
3. **Run the full test suite**: `npm run test:coverage` (and `npm run test:contracts`, `npm run test:property` if the package is used in those layers).
4. **Targeted manual testing** of the flows that exercise the package (see package-specific sections below).
5. **Check `npm audit`** post-upgrade to confirm the bump didn't introduce a new advisory.
6. Open the PR with the changelog link and a summary of what was manually tested — reviewers shouldn't have to re-derive that from the diff.

## `@stellar/stellar-sdk`

Pinned to an exact version in `renovate.json` (`rangeStrategy: pin`) — see [CONTRIBUTING.md's Renovate table](../../CONTRIBUTING.md#what-renovate-manages). This is the highest-risk dependency in the repo: it talks directly to the Stellar network, and a breaking change here can silently corrupt transactions rather than just fail a build.

**What to test on testnet before merging** (exercise these against `HORIZON_URL=https://horizon-testnet.stellar.org`, per [README.md § Testnet Setup](../../README.md#testnet-setup)):

| Flow | Backend entry point |
| --- | --- |
| Account creation + Friendbot funding | `createAccount()` in [`backend/src/services/stellar.js`](../../backend/src/services/stellar.js) |
| Balance query | `getBalance()` in `backend/src/services/stellar.js` |
| Payment send (XLM and a non-native asset) | `sendPayment()` in `backend/src/services/stellar.js` |
| Path payment | [`backend/src/services/pathPayment.js`](../../backend/src/services/pathPayment.js) |
| Trustline create/update/remove | `createTrustline()` / `updateTrustlineLimit()` / `removeTrustline()` in `backend/src/services/stellar.js` |
| Payment streaming | [`backend/src/services/paymentNotificationMonitor.js`](../../backend/src/services/paymentNotificationMonitor.js) — needs `STREAM_SECRET_ENCRYPTION_KEY` set; see [backend/STREAMING_SECURITY.md](../../backend/STREAMING_SECURITY.md) |
| Fee bump / multi-sig | `wrapWithFeeBump()` in `backend/src/services/stellar.js`, [`backend/src/services/multiSig.js`](../../backend/src/services/multiSig.js) |

Specifically watch for:

- Changes to `StellarSDK.TransactionBuilder`, `Operation`, `Asset`, or `Memo` constructor signatures — these are used directly in `sendPayment()`.
- Changes to Horizon error response shapes — `extractStellarErrorCode()` in [`backend/src/utils/stellarErrors.js`](../../backend/src/utils/stellarErrors.js) pattern-matches on `error.data.extras.result_codes`, `error.status`, and `error.name`; a shape change there breaks error mapping silently rather than throwing. See [docs/guides/stellar-errors.md](stellar-errors.md).
- Sequence-number and retry behavior — `withHorizonRetry()` in `backend/src/services/stellar.js` retries transient failures but explicitly does *not* retry 400/404/409; confirm the new SDK version still raises the same status codes for those cases.
- Network passphrase / `Networks.TESTNET` / `Networks.PUBLIC` constants, if the SDK restructures its network config.

## Prisma (`prisma`, `@prisma/client`, `@prisma/adapter-pg`)

Grouped together by Renovate to stay in sync (`renovate.json`'s `Prisma` packageRule) — never upgrade the CLI and client independently.

1. After bumping, regenerate the client and diff the output:
   ```bash
   cd backend
   npx prisma generate
   git diff --stat  # generated types shouldn't need review, but confirm nothing unexpected changed
   ```
2. Check for pending schema drift before deploying:
   ```bash
   npx prisma migrate diff \
     --from-schema-datasource prisma/schema.prisma \
     --to-schema-datamodel prisma/schema.prisma
   ```
3. Run migrations against a local database and confirm they still apply cleanly:
   ```bash
   DATABASE_URL="<value>" npx prisma migrate deploy
   ```
   See [backend/CONFIGURATION.md](../../backend/CONFIGURATION.md) for `DATABASE_URL` / `DB_SHARD_0_URL` and the other Prisma-related env vars.
4. Run `npm run test:coverage` — Prisma major bumps have historically changed generated type shapes and `$queryRaw`/`$executeRaw` behavior (see [docs/guides/security.md § SQL / NoSQL Injection](security.md#sql--nosql-injection) for the safe-usage pattern this codebase relies on).
5. If the bump changes migration file format or history table structure, read the Prisma migration guide for that version before touching production — this is the one case where the general checklist isn't sufficient on its own.

## React / Vite

No `renovate.json` grouping today, but the frontend stack has already been through at least one significant migration ([frontend/REACT_QUERY_MIGRATION.md](../../frontend/REACT_QUERY_MIGRATION.md)) — treat future majors with the same care.

1. Read the React or Vite release notes for removed APIs, changed defaults (e.g. Vite's `build.target`, React's strict-mode behavior changes), and plugin compatibility — `@vitejs/plugin-react` must support the target Vite major.
2. Run `npm run build --workspace=frontend` and confirm the build succeeds with no new warnings.
3. Run `npm run typecheck --workspace=frontend` and the frontend unit test suite (`npm run test --workspace=frontend`).
4. Run the E2E suite (`npx playwright test`, per [CONTRIBUTING.md § Writing E2E tests](../../CONTRIBUTING.md#writing-e2e-tests)) — React major bumps are more likely to break runtime behavior (effects, suspense boundaries) than to fail a type check.
5. Manually click through the golden path in a dev build (`npm run dev:frontend`) — account creation, payment send, balance check — since visual/runtime regressions from a renderer change won't necessarily show up in existing tests.

## Rolling back a merged dependency bump

If a dependency upgrade turns out to be broken after merge:

1. Revert the merge commit (the Renovate/Dependabot PR merge, or your manual-upgrade PR merge) with `git revert`, not a force-push — this preserves history and re-triggers CI on the revert.
2. Redeploy from the reverted `main` following your normal deploy process.
3. If the break was caught in production rather than CI, follow [docs/runbook.md](../runbook.md) for incident handling (triage, incident record, containment) before or alongside the revert.
4. Re-open the upgrade as a fresh PR once the underlying issue (in the package or in this codebase's usage of it) is understood, rather than re-merging the same commit.
