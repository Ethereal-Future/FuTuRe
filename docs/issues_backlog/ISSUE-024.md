# services/stellar.ts: Divergence and code duplication between stellar.js and stellar.ts services causes typing and runtime behavioral drift

**Domain:** Stellar Blockchain Services  
**Complexity:** Hard  
**Labels:** `enhancement`, `stellar`, `architecture`, `dx`  
**Issue ID:** ISSUE-024

---

## Background
The codebase contains two massive, parallel implementations of the Stellar service:
- `backend/src/services/stellar.js` (1288 lines)
- `backend/src/services/stellar.ts` (1138 lines)
Both define `sendPayment`, `createAccount`, `changeTrust`, `getHorizonServer`, etc., but with subtle differences in error handling, retry backoffs, and parameters.

## Problem
- Bug fixes applied to `stellar.js` (such as issue #1119 or #1127) are not replicated in `stellar.ts`, and vice-versa.
- TypeScript consumers importing `stellar.ts` execute divergent logic compared to JavaScript consumers importing `stellar.js`.
- Maintaining two parallel 1,000+ line blockchain integration files introduces technical debt, confusion for contributors, and severe risk of regression.

## Proposed Solution
Consolidate the Stellar service into a single source of truth. Either migrate the backend fully to TypeScript and compile `stellar.ts` to `stellar.js`, or convert `stellar.js` to TypeScript with a proper `.d.ts` declaration file and delete the redundant duplicate file.

## Implementation Steps
1. Perform a line-by-line diff of features, bugfixes, and types between `stellar.js` and `stellar.ts`.
2. Merge all fixes into a single canonical `backend/src/services/stellar.js` (with JSDoc / TS type definitions).
3. Remove `backend/src/services/stellar.ts` or configure build pipeline to emit JS from TS.
4. Update all import references across routes, services, and tests to point to the canonical module.
5. Ensure entire test suite passes against the unified service.

## Acceptance Criteria
- [ ] Only one canonical Stellar service implementation exists in the repository.
- [ ] All type definitions and runtime features are preserved without regression.
- [ ] Code duplication reduced by >1,000 lines.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1271](https://github.com/Ethereal-Future/FuTuRe/issues/1271)
