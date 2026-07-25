# Coverage Follow-up Issues (#479)

The following 5 files have **0% coverage** (no tests exist). Each requires a dedicated follow-up issue.

---

## Issue 1: Add unit tests for `frontend/src/utils/validateStellarAddress.js`

**File:** `frontend/src/utils/validateStellarAddress.js`  
**Current coverage:** 0% (lines, branches, functions, statements)

**What needs testing:**
- `isValidStellarAddress(address)` — happy path with a valid Ed25519 public key
- Rejects `null`, `undefined`, empty string, non-string types
- Rejects malformed addresses (wrong length, wrong prefix, invalid chars)
- Rejects Stellar secret keys (starts with `S`)

**Acceptance criteria:** 100% branch coverage, all edge cases covered.

---

## Issue 2: Add unit tests for `frontend/src/utils/animations.js`

**File:** `frontend/src/utils/animations.js`  
**Current coverage:** 0% (lines, branches, functions, statements)

**What needs testing:**
- All exported animation variant objects/functions
- Any conditional logic (e.g., reduced-motion checks, parameter-driven variants)

**Acceptance criteria:** 100% branch coverage.

---

## Issue 3: Add unit tests for `frontend/src/utils/errorLogger.js`

**File:** `frontend/src/utils/errorLogger.js`  
**Current coverage:** 0% (lines, branches, functions, statements)

**What needs testing:**
- Error logging function — verify it calls `console.error` (or the configured sink) with correct args
- Conditional branches: different error shapes (Error object, string, plain object)
- Any environment-gated logic (e.g., only logs in non-production)

**Acceptance criteria:** 100% branch coverage, `console.error` spy used to avoid side effects.

---

## Issue 4: Add unit tests for `frontend/src/utils/webVitals.js`

**File:** `frontend/src/utils/webVitals.js`  
**Current coverage:** 0% (lines, branches, functions, statements)

**What needs testing:**
- `reportWebVitals` (or equivalent) — verify it calls the provided callback
- Branch: callback provided vs. not provided
- Mock `web-vitals` module to avoid real browser API dependency

**Acceptance criteria:** 100% branch coverage, web-vitals mocked.

---

## Issue 5: Add unit tests for `frontend/src/utils/searchHighlighter.js` (remaining branches)

**File:** `frontend/src/utils/searchHighlighter.js`  
**Current coverage:** 0% (no tests in `utils.test.js` cover this file)

**What needs testing:**
- `highlightSearchTerms(text, query)`:
  - Empty `query` → returns `text` unchanged
  - Empty `text` → returns `text` unchanged (falsy branch)
  - Case-insensitive match wraps term in `<mark>`
  - Multiple occurrences all wrapped
  - Special regex characters in query (e.g., `(`, `.`, `*`) don't throw
- `filterTransactions(transactions, criteria)`:
  - All filter branches: `query`, `type`, `status`, `dateFrom`, `dateTo`, `amountMin`, `amountMax`, `address`
  - Each filter independently, and combined
  - Empty `transactions` array
  - `criteria` with no filters → returns all

**Acceptance criteria:** 100% branch coverage.
