# scripts/check-i18n-strings.mjs: Missing `acorn` dependency in root package.json causes CI job failure

**Domain:** CI/CD & Tooling  
**Complexity:** Medium  
**Labels:** `bug`, `ci-cd`, `i18n`  
**Issue ID:** ISSUE-193

---

## Background
In `scripts/check-i18n-strings.mjs`:
The script parses JSX and JS files with the Acorn JavaScript parser to detect untranslated strings in UI components.

## Problem
- `scripts/check-i18n-strings.mjs` imports `acorn` directly: `import * as acorn from 'acorn';`.
- However, `acorn` is only installed as a nested transitive dependency of Vite in `frontend/node_modules/`, and is NOT listed in root `package.json`.
- When CI runs `npm test` or `node scripts/check-i18n-strings.mjs` from the repository root:
  `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'acorn' imported from scripts/check-i18n-strings.mjs`.
- The i18n lint check fails consistently on clean CI checkout environments!

## Proposed Solution
1. Add `acorn` and `acorn-jsx` to root `devDependencies` in `package.json`.
2. Or update `scripts/check-i18n-strings.mjs` to resolve `acorn` via `createRequire` pointing to `frontend/node_modules/acorn` if present.
3. Ensure root `npm install` provides all necessary tooling dependencies.

## Implementation Steps
1. Add `"acorn": "^8.11.0"` and `"acorn-jsx": "^5.3.2"` to root `package.json` `devDependencies`.
2. Run `npm install` to update `package-lock.json`.
3. Verify `node scripts/check-i18n-strings.mjs` executes cleanly without import errors.

## Acceptance Criteria
- [ ] `check-i18n-strings.mjs` runs successfully in fresh clone environments.
- [ ] No `ERR_MODULE_NOT_FOUND` errors in CI.
- [ ] Missing translation keys are accurately reported.

## Notes
- **Complexity Rating:** Medium
- **Subsystem Notes:** Fixes root CI script dependency resolution.

**GitHub Issue:** [1440](https://github.com/Ethereal-Future/FuTuRe/issues/1440)
