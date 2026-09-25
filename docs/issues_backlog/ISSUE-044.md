# services/pool.js, offer.js, trustline.js, feeHistory.js: Import non-existent config/stellar.js causing fatal runtime crashes on invocation

**Domain:** Stellar Blockchain Services  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `critical-bug`, `backend`  
**Issue ID:** ISSUE-044

---

## Background
Four core service files in `backend/src/services/` import from `'../config/stellar.js'`:
- `backend/src/services/feeHistory.js` (line 1): `import { horizonServer } from '../config/stellar.js';`
- `backend/src/services/offer.js` (line 1): `import { horizonServer, networkPassphrase } from '../config/stellar.js';`
- `backend/src/services/pool.js` (line 2): `import { horizonServer, networkPassphrase } from '../config/stellar.js';`
- `backend/src/services/trustline.js` (line 1): `import { horizonServer, networkPassphrase } from '../config/stellar.js';`
However, `backend/src/config/stellar.js` does NOT exist in the repository!

## Problem
- Any route or worker calling functions from `pool.js` (e.g. `POST /api/stellar/pool/deposit`), `offer.js` (e.g. `POST /api/stellar/offers`), `trustline.js`, or `feeHistory.js` crashes immediately with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../config/stellar.js'`.
- The test suite masked this bug by mocking the entire service modules (`vi.mock('../src/services/offer.js')`), so CI passed while production execution is completely broken.
- DEX offer creation, liquidity pool estimation/execution, and trustline management endpoints are entirely inoperable.

## Proposed Solution
Create `backend/src/config/stellar.js` exporting the canonical `horizonServer` instance and `networkPassphrase` (derived from `getConfig().stellar`), or refactor all four services to import `getHorizonServer()` and passphrase helpers directly from `backend/src/services/stellar.js` and `backend/src/config/env.js`.

## Implementation Steps
1. Create `backend/src/config/stellar.js` properly configured with `getConfig().stellar.horizonUrl` and `networkPassphrase`.
2. Alternatively, update imports in `feeHistory.js`, `offer.js`, `pool.js`, and `trustline.js` to import `getHorizonServer` from `stellar.js`.
3. Remove artificial module mocks in tests and add real integration tests executing the import graph.
4. Verify all routes in `routes/stellar/offers.js` and `routes/stellar/pool-operations.js` load without runtime errors.

## Acceptance Criteria
- [ ] `ERR_MODULE_NOT_FOUND` error is resolved.
- [ ] All four services successfully import Horizon server configuration.
- [ ] Unmocked import tests verify that the entire backend service tree compiles and loads cleanly.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1291](https://github.com/Ethereal-Future/FuTuRe/issues/1291)
