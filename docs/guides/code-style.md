# Code Style Guide

This guide separates conventions that ESLint/Prettier already check on every commit from conventions you have to remember yourself, because nothing catches a violation automatically. When in doubt about which bucket a rule is in, check the config files linked below rather than assuming — this guide is audited against them, not the other way around.

---

## Enforced by tooling

Don't memorize these — run them:

```bash
npm run format   # applies Prettier
npm run lint     # ESLint check
```

**Formatting** — [`.prettierrc`](../../.prettierrc): semicolons, single quotes, 2-space indent, trailing commas, 100-char print width, LF line endings.

**Linting** — flat ESLint config (ESLint 9), split by workspace:

- [`eslint.config.js`](../../eslint.config.js) (root) — covers `backend/src/**`, `backend/tests/**`, `testing/**`. Ignores `frontend/**` and `scripts/**`.
- [`frontend/eslint.config.js`](../../frontend/eslint.config.js) — covers `frontend/src/**`.

Rules actually enforced today, across both configs:

| Rule | What it catches |
|---|---|
| `no-unused-vars` (warn, `argsIgnorePattern: '^_'`) | Unused variables/imports. Prefix an intentionally-unused parameter with `_` to silence it. |
| `no-shadow` (error) | A variable shadowing an outer-scope binding. |
| `no-console` (warn) | Stray `console.*` calls in `backend/src` and `frontend/src`. |
| `react/*` + `react-hooks/*` recommended rules (frontend only) | Standard React correctness rules (rules-of-hooks, exhaustive-deps, JSX-runtime rules, etc.), via `frontend/eslint.config.js`. |
| `no-restricted-syntax` on hex-color literals (frontend only) | Blocks hardcoded `#rrggbb`-style colors in JS/JSX — use a token from `frontend/src/design-system/tokens.js` or a CSS custom property instead. |

Two notes if you're reading the configs directly:

- A root-level [`.eslintrc.js`](../../.eslintrc.js) also exists but is the legacy (pre-flat-config) format. ESLint 9's default resolution uses the flat `eslint.config.js` files above; treat `.eslintrc.js` as stale rather than a second source of truth.
- `backend/src/notifications/channels/email.js` and `channels/sms.js` are explicitly carved out in the root config to allow a `require` global — see [ES modules](#es-modules-only) below for why that's the one sanctioned exception to the ES-modules-only rule.

**TypeScript** — `tsc --noEmit` runs in CI (`lint` job) against the mixed JS/TS backend; see the [TypeScript Migration](../../CONTRIBUTING.md#typescript-migration-issue-771) section of `CONTRIBUTING.md`.

---

## Manual conventions

Nothing in CI checks these. A reviewer has to remember to look for them.

### ES modules only

`import`/`export` throughout — no `require()`. The only sanctioned exception is `backend/src/notifications/channels/{email,sms}.js`, which are explicitly allow-listed in `eslint.config.js` for a `require` global; don't add new exceptions without updating that config alongside the code.

### Async/await over `.then()`

Prefer `async`/`await` to `.then()` chains. No lint rule enforces this (there is no `promise/prefer-await-to-then` or similar installed) — it's a readability convention for reviewers to enforce by eye.

### Keep functions small and single-purpose

Avoid deeply nested callbacks. No `complexity` or `max-depth` ESLint rule is configured, so this is judgment-based at review time, not a hard limit.

### JSDoc for backend services

Every exported function in `backend/src/services/` needs a JSDoc block with a summary, `@param` per parameter, `@returns`, `@throws` where applicable, and an `@example` for non-obvious functions. This is **not** enforced by ESLint — see [issue #815](https://github.com/Ethereal-Future/FuTuRe/issues/815) for the tracked follow-up to add `eslint-plugin-jsdoc`. See any file in `backend/src/services/` for the established style.

### RTL / logical-properties CSS and image assets

Covered in their own guides rather than duplicated here:

- **RTL CSS rules** (logical properties instead of physical directional ones) and the full i18n workflow: [`docs/guides/i18n.md`](i18n.md).
- **Image assets** — new raster assets (PNG/JPG/WebP) must ship at 1x/2x/3x resolution (`name.png`, `name@2x.png`, `name@3x.png`):
  - In JSX, use `<ResponsiveImg src="/logo.png" alt="..." />` (`frontend/src/components/ResponsiveImg.jsx`) instead of a plain `<img>` — it derives the `srcset` from the 1x path via `buildSrcSet()`.
  - In CSS `background-image` declarations, build the value with `buildImageSet()` from `frontend/src/utils/responsiveImage.js`.
  - Prefer SVG for logos/icons — resolution-independent, sidesteps the requirement entirely.
  - Nothing currently checks for a missing `@2x`/`@3x` variant or a raw `<img>`/`background-image` bypassing these helpers — this is enforced by review only.

### Naming and file organization

Derived from the patterns actually used in the codebase, not invented:

**Backend** (`backend/src/`):

| What | Convention | Example |
|---|---|---|
| Route module | camelCase (or single lowercase word) `.js`, named after the resource, in `backend/src/routes/`. Sub-resources get a nested directory. | `routes/multiSig.js`, `routes/stellar/contract.js` |
| Service module | camelCase `.js`, named after the domain concept, in `backend/src/services/` | `services/keypairRotation.js`, `services/lowBalanceMonitor.js` |
| Test file | `backend/tests/<name>.test.js` — a **separate top-level directory**, not colocated with the source it tests, despite the file being named after it (e.g. `backend/src/auth/tokens.js` → `backend/tests/auth.tokens.test.js`). One historical exception exists (`backend/src/services/pathPayment.test.js`, colocated); treat the top-level `backend/tests/` location as the convention for new tests, not the exception. |

**Frontend** (`frontend/src/`):

| What | Convention | Example |
|---|---|---|
| Component | PascalCase `.jsx` in `frontend/src/components/`. Storybook stories and component-scoped CSS are colocated with the same base name. | `components/CopyButton.jsx`, `components/CopyButton.stories.jsx` |
| Page | PascalCase `.jsx` with a `Page` suffix, in `frontend/src/pages/` | `pages/SendPaymentPage.jsx` |
| Hook | camelCase with a `use` prefix, `.js`, in `frontend/src/hooks/` | `hooks/useDebounce.js` |
| Test file | `frontend/tests/<Name>.test.jsx` — a separate top-level directory mirroring `frontend/src/` component names, not colocated inside `frontend/src/`. | `frontend/src/components/XLMInfoIcon.jsx` → `frontend/tests/XLMInfoIcon.test.jsx` |

Test files end in `.test.js`, `.test.jsx`, `.spec.js`, or `.spec.jsx` in both workspaces; see `CONTRIBUTING.md`'s [Testing](../../CONTRIBUTING.md#testing) section for how to write them. Note this diverges from that section's own illustrative example (`frontend/src/components/Button.test.jsx`, implying colocation) — actual practice in both workspaces is a top-level `tests/` directory, as documented above.

### Error handling in backend routes

The codebase has **two** error-handling mechanisms, and only one of them is actually used consistently:

1. **What routes actually do (the dominant pattern — follow this for new routes):** wrap the handler body in `try { ... } catch (error) { ... }`, log via a small local `logError(req, error, context)` helper (`logger.error('route.error', { requestId, correlationId, method, path, ...context, error: error.message, stack: error.stack })`), and respond directly with `res.status(<code>).json({ error: '<message>' })`. This is what the large majority of `backend/src/routes/*.js` handlers do.
2. **What also exists but is barely used:** `backend/src/middleware/errorHandler.js` defines `AppError`/`StellarError`/`ValidationError`, an `ErrorCodes` enum, `asyncHandler()` (wraps a handler so a thrown/rejected error reaches `next(err)` automatically), and a centralized `errorHandler` middleware that formats a richer `{ success: false, error: { code, message, requestId, correlationId, ... } }` envelope. It **is** wired up in `server.js` as the final middleware (via `app.use(notFoundHandler)` / `app.use(errorHandler)`), but almost no route handler throws `AppError` or uses `asyncHandler` to reach it — nearly every route instead catches and responds locally as in (1).

**Recommendation for new code:** follow the dominant pattern (1) for consistency with the existing 25+ route files, using `logError`-style logging and a flat `{ error: '<message>' }` response. Do not introduce a third style.

This is a real inconsistency, not a documented decision — the centralized `AppError`/`asyncHandler` system in `errorHandler.js` is fully built and wired at the app level but effectively dead code from the route layer's perspective, and the per-file `logError` helper is copy-pasted (not imported from a shared module) into over a dozen route files independently. Consolidating on one system — likely adopting `asyncHandler` + `AppError` throughout and deleting the duplicated `logError` helpers — is worth its own refactor issue rather than being fixed piecemeal as a side effect of unrelated route changes.

### Prisma query patterns

`docs/adr/0002-prisma-orm.md` documents why Prisma was chosen but not query-shape conventions. Two recommendations, stated here for the first time rather than pulled from an existing house convention (the codebase does not yet follow either consistently — see the caveat below):

- **Wrap multi-step writes in `prisma.$transaction(...)`.** As of this writing, no file under `backend/src` uses `$transaction` — multi-step writes (e.g. debiting one balance and crediting another) are issued as separate, unwrapped queries. This is a correctness risk (a crash between steps leaves the database in a partially-written state), not just a style preference. Treat this as the target convention for new multi-step write code; bringing existing multi-step writes under a transaction is a separate, larger change and should be scoped as its own issue rather than folded into unrelated PRs.
- **Paginate `findMany`.** Prefer `take`/`skip` or cursor-based pagination (`cursor`) over an unbounded `findMany()` for any query that can grow with user data. Roughly a third of existing `findMany` calls in `backend/src` already do this; the rest do not. New queries against tables that grow with usage (transactions, events, audit logs) should paginate; a `findMany` against a small, bounded table (e.g. a config or lookup table) does not need to.
