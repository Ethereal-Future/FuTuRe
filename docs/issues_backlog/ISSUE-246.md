# backend/src/routes/stellar/index.js: Duplicate route mounting for /trustline and broken /assets endpoint

**Domain:** Backend & Routing  
**Complexity:** Medium  
**Labels:** `bug`, `routing`, `stellar`  
**Issue ID:** ISSUE-246

---

## Background
`backend/src/routes/stellar/index.js` mounts the trustline routers like this:

```js
router.use('/trustline', trustlinesRouter);
router.use('/trustline', trustlineBalanceRouter);
router.use('/assets', trustlinesRouter);
```

`trustlinesRouter` (`trustlines.js`) defines `GET /assets`, `POST /create` and `DELETE /remove`. `trustlineBalanceRouter` (`trustline-balance.js`) defines `GET /balances/:accountId` and `POST /modify-limit`.

This produces the following URLs:

| URL | Result |
| :--- | :--- |
| `GET /api/stellar/assets` | **404**, because `trustlinesRouter` has no `/` route |
| `GET /api/stellar/assets/assets` | 200 (accidental path) |
| `POST /api/stellar/assets/create`, `DELETE /api/stellar/assets/remove` | Trustline mutations exposed under a second, unintended prefix |
| `GET /api/stellar/trustline/assets` | 200 |
| `/api/stellar/trustline/*` | Two routers on one prefix. Express runs them in mount order, so any path both routers define (now or later) is silently handled by `trustlinesRouter` |

## Problem
- The documented endpoint `GET /api/stellar/assets` does not work.
- Every trustline route is reachable through two prefixes, so there are two attack surfaces, two sets of rate-limit keys and confusing logs.
- Two routers sharing `/trustline` hide handlers depending on mount order and make route ownership unclear.

## Proposed Solution
- Remove `router.use('/assets', trustlinesRouter)` and add an explicit `GET /assets` handler. The list-building logic can live in a small `assetsRouter` or a shared function exported from `trustlines.js`.
- Mount a single router at `/trustline`. Either merge `trustline-balance.js` routes into `trustlines.js`, or have `trustlinesRouter` mount the balance router as a sub-router so there is one entry point with a known route order.
- Keep `GET /api/stellar/trustline/assets` working as an alias if the frontend uses it.

## Implementation Steps
1. Move the supported-assets builder (`SUPPORTED_ASSETS.map(...)`) into a shared function and expose it at `GET /api/stellar/assets`.
2. Delete the `/assets` mount of `trustlinesRouter`.
3. Combine the two `/trustline` routers into one mount and check that no paths overlap.
4. Search `frontend/src` for `/api/stellar/assets/` and `/api/stellar/trustline/` callers and update them.
5. Add route tests: `GET /api/stellar/assets` → 200 with `{ assets }`, `GET /api/stellar/assets/assets` → 404, and one test per trustline endpoint for the expected handler.

## Acceptance Criteria
- [ ] `GET /api/stellar/assets` returns supported assets with `200 OK`.
- [ ] Trustline operations route unambiguously to their target handlers under a single `/api/stellar/trustline` mount.
- [ ] Trustline mutation endpoints are no longer reachable under `/api/stellar/assets/*`.

## Notes
- **Complexity Rating:** Medium
- Related: ISSUE-247 (`/trustline/modify-limit` security), which touches the same router.

**GitHub Issue:** [1560](https://github.com/Ethereal-Future/FuTuRe/issues/1560)
