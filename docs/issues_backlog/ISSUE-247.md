# backend/src/routes/stellar/trustline-balance.js: /modify-limit accepts cleartext sourceSecret without authentication

**Domain:** Backend & Security  
**Complexity:** High  
**Labels:** `bug`, `security`, `stellar`, `critical-bug`  
**Issue ID:** ISSUE-247

---

## Background
`backend/src/routes/stellar/trustline-balance.js` (lines 61-70) defines the following route, reachable as `POST /api/stellar/trustline/modify-limit`:

```js
router.post('/modify-limit', async (req, res) => {
  const { sourceSecret, assetCode, issuer, newLimit } = req.body;
  const result = await updateTrustlineLimit(sourceSecret, assetCode, issuer, newLimit);
  res.json(result);
});
```

`updateTrustlineLimit` (`backend/src/services/stellar.js:1326`) calls `Keypair.fromSecret(sourceSecret)`, builds a `changeTrust` transaction, signs it on the server and submits it.

The route has no `requireAuth` and no `validate`/`rules` middleware. The frontend caller (`frontend/src/components/AssetBalanceWithTrustline.jsx:67`) currently sends `sourceSecret: ''`.

## Problem
- **No authentication:** anyone can call the endpoint.
- **Secrets in transit and at rest:** the account's secret key crosses the network in a JSON body. It can be captured by proxies, request logs, APM/error tooling, or the `logError` call in this route, and the server handles it in memory.
- **Custody model violation:** the backend should never see a user's secret key. `contract.js` already moved to client-side signing and rejects `sourceSecret` (`rejectSourceSecret`, around line 183). This route was never migrated.
- **No input validation:** `assetCode`, `issuer` and `newLimit` go straight into the service without validation.

## Proposed Solution
Use the same build → sign → submit pattern as `contract.js`:

1. `POST /trustline/modify-limit/build` (authenticated): takes `{ publicKey, assetCode, issuer, newLimit }`, returns an unsigned `changeTrust` transaction XDR.
2. The client signs it locally (Freighter or another wallet).
3. `POST /trustline/modify-limit` (authenticated): takes `{ signedTxXdr }`, checks that it contains exactly one `changeTrust` operation for the authenticated user's account, and submits it.

Any request body that contains `sourceSecret` is rejected with `400`.

## Implementation Steps
1. Add `requireAuth` to both routes, and `requireOwnAccount` (or an equivalent check) so `publicKey` belongs to the authenticated user.
2. Reuse or extract `rejectSourceSecret` from `contract.js` into shared middleware and apply it to this route.
3. Add `rules.modifyTrustlineLimit` to `middleware/validate.js`: valid asset code (1-12 alphanumeric characters), valid issuer `G...` StrKey, and `newLimit` as a non-negative decimal string with at most 7 decimal places.
4. Split `updateTrustlineLimit` into `buildTrustlineLimitTx(publicKey, ...)` (unsigned XDR) and a submit step that validates the signed envelope.
5. Update `AssetBalanceWithTrustline.jsx` to call `/build`, sign with the wallet, and submit `signedTxXdr`.
6. Make sure `logError` and request logging never record request bodies for this route.
7. Add tests: no token → `401`, body containing `sourceSecret` → `400`, invalid inputs → `400`, an envelope for a different account or with extra operations → `400`/`403`, valid signed XDR → `200`.

## Acceptance Criteria
- [ ] The endpoint rejects unauthenticated requests with `401`.
- [ ] Cleartext secrets are not accepted in request bodies: any body containing `sourceSecret` returns `400`.
- [ ] Trustline limit changes are signed on the client and the server never handles a secret key.
- [ ] Inputs are validated by `express-validator` rules before reaching the service.

## Notes
- **Complexity Rating:** High
- Precedent: `backend/src/routes/stellar/contract.js` (`/invoke/build` + `/invoke` with `signedTxXdr`).
- Related: ISSUE-246 (routing of the `/trustline` routers).

**GitHub Issue:** [1561](https://github.com/Ethereal-Future/FuTuRe/issues/1561)
