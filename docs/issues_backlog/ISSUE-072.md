# auth/password.js: Syntax error from TypeScript type annotations in JavaScript file prevents module loading and server initialization

**Domain:** Authentication & Tokens  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `backend`, `critical-bug`  
**Issue ID:** ISSUE-072

---

## Background
In `backend/src/auth/password.js` (line 17):
```javascript
 export function calculatePercentageChange(current: number, previous: number) {
```
The file is an ES Module `.js` file, but contains raw TypeScript type annotations (`current: number, previous: number`).

## Problem
- Running `node -c backend/src/auth/password.js` or importing `backend/src/auth/password.js` in Node.js fails immediately with:
  `SyntaxError: Unexpected token ':'`
- Any authentication route importing password utilities fails to load.
- Node.js 20 does not strip TypeScript syntax in `.js` files by default.
- This syntax error breaks server boot or test execution wherever `password.js` is imported.

## Proposed Solution
Remove the TypeScript type annotations from `backend/src/auth/password.js` and replace them with standard JSDoc comments:
```javascript
/**
 * @param {number} current
 * @param {number} previous
 * @returns {number}
 */
export function calculatePercentageChange(current, previous) {
```

## Implementation Steps
1. Edit `backend/src/auth/password.js` to remove `: number` type annotations.
2. Add JSDoc annotations for types.
3. Run `node -c backend/src/auth/password.js` to verify syntax validity.
4. Add a CI lint step validating that all `.js` files pass `node -c`.

## Acceptance Criteria
- [ ] `backend/src/auth/password.js` is valid JavaScript and compiles cleanly in Node.js 20.
- [ ] `node -c` passes without syntax errors.
- [ ] Password helper functions export and execute as expected.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1319](https://github.com/Ethereal-Future/FuTuRe/issues/1319)
