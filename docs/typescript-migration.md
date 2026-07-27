# TypeScript Migration Plan

## Motivation and Goals

FuTuRe's backend is currently written in JavaScript (Node.js + ES modules). As the codebase grows
— handling financial transactions, authentication, WebSocket connections, and Stellar network
integration — the absence of static typing creates bugs that only surface at runtime. This
migration plan introduces TypeScript incrementally to:

- Catch type errors at compile time rather than in production
- Make service function contracts explicit and enforceable
- Improve refactor confidence across the codebase
- Provide always-up-to-date documentation via type annotations
- Complement JSDoc annotations (issue #815) with compiler-enforced contracts

## Migration Approach

**Incremental file-by-file conversion.** Rather than rewriting the entire backend at once, we
migrate one service file per PR. This keeps diffs small and reviewable, avoids blocking feature
work, and lets us validate the TypeScript configuration against real code at each step.

Key principles:

1. Start with `allowJs: true` so JS and TS files coexist during the transition.
2. Set `strict: true` from day one — retrofitting strict mode later is painful.
3. Migrate leaf modules first (no/few dependants) before high-traffic modules.
4. Never add `@ts-ignore` without a dated justification comment; prefer fixing the type.

### Migration order (recommended)

| Priority | File | Reason |
|---|---|---|
| 1 ✅ | `services/stellar.ts` | Pilot — most complex, highest correctness value |
| 2 | `services/circuitBreaker.ts` | Small, no dependants |
| 3 | `services/feeSurge.ts` | Small utility |
| 4 | `services/feeHistory.ts` | Isolated |
| 5 | `services/retryMetrics.ts` | Isolated |
| 6 | `services/transactionErrorHandler.ts` | Medium |
| 7 | `services/transactionRetry.ts` | Medium |
| 8 | `routes/*.ts` | After services are typed |
| 9 | `server.ts` | Last — entry point |

## TypeScript Configuration

`backend/tsconfig.json` is configured with:

- `allowJs: true` — JS files are included so the compiler can check mixed codebases
- `noEmit: true` — compile for type-checking only; Node.js runs the original JS files
- `strict: true` — full strict mode from the start (no gradual `any` accumulation)
- `moduleResolution: bundler` — compatible with Node.js ES module resolution
- `target: ES2022` — matches the Node 20 runtime

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

`checkJs: false` means existing `.js` files are included for cross-file type inference but are
not themselves type-checked. Flip this to `true` for a file once it is ready for stricter checks.

## Tooling Changes Required

### Dev dependencies to add

```bash
npm install --save-dev typescript@5 @types/node@20 ts-node@10
# Stellar SDK ships its own types — no separate @types/stellar-sdk needed
# Add types for other packages as needed:
npm install --save-dev @types/express @types/jsonwebtoken @types/bcryptjs @types/ws
```

### ESLint TypeScript rules

Add `@typescript-eslint` to `backend/.eslintrc.js` (or the flat config equivalent):

```js
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tsParser },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
];
```

### CI check

CI runs `npx tsc --noEmit` in the `backend/` directory as part of the `lint` job. This ensures
every PR that touches `.ts` files must compile cleanly before merge.

## Timeline and Milestones

| Milestone | Target | Description |
|---|---|---|
| M0 — Tooling | Week 1 | tsconfig, TS deps, ESLint rules, CI check |
| M1 — Pilot | Week 1 | `stellar.ts` compiles without errors |
| M2 — Utilities | Weeks 2–3 | Migrate small service files (circuitBreaker, feeSurge, etc.) |
| M3 — Core services | Weeks 4–6 | Migrate transactionRetry, transactionErrorHandler |
| M4 — Routes | Weeks 7–9 | Migrate all route handlers |
| M5 — Entry point | Week 10 | Migrate `server.js` → `server.ts`; remove `allowJs` |

## Review and Approval Process

1. Each migrated file ships as its own PR with the label `typescript-migration`.
2. The PR must pass `tsc --noEmit` and all existing tests without modification.
3. At least one reviewer must verify there are no `@ts-ignore` additions without justification.
4. Types must not weaken existing behaviour — `any` is a last resort, not a shortcut.
5. After M5, open an issue to enable `checkJs: false` globally and remove `allowJs`.
