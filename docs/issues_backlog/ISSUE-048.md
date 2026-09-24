# routes/stellar/amm.js: Missing validation for non-native asset issuers in AMM pool query parameters allows injection of spoofed pools

**Domain:** AMM & Liquidity Pools  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `security`, `validation`  
**Issue ID:** ISSUE-048

---

## Background
In `backend/src/routes/stellar/amm.js`, endpoints like `/pools`, `/arbitrage/:assetA/:assetB`, and `/pool/:poolId` parse asset identifiers from route parameters or query strings:
```javascript
const { assetA, assetB } = req.params;
```
Asset strings can be passed as `'XLM'`, `'USDC'`, or `'USDC:GISSUER...'`.

## Problem
- When asset parameters are passed without an explicit issuer (e.g. `assetA=USDC`), the code calls `getIssuer(asset)` or defaults to native.
- If a client supplies a malformed or malicious asset string (e.g. an issuer belonging to an untrusted or scam token), the backend builds queries or fetches pool data without validating the issuer's public key format.
- Attackers can direct the backend to query or index scam pools designed to phish users or spoof official asset tickers.

## Proposed Solution
Validate all asset identifiers using a strict validator:
- If asset is native: must be strictly `'XLM'`.
- If asset is alphanumeric: must follow format `CODE:ISSUER` where `CODE` is 1-12 alphanumeric characters and `ISSUER` is a valid 56-character ed25519 public key starting with `'G'`.
- Validate `ISSUER` using `StellarSDK.StrKey.isValidEd25519PublicKey(issuer)`.
- Reject invalid asset strings with HTTP 400 Bad Request.

## Implementation Steps
1. Create `parseAndValidateAsset(assetStr)` in `backend/src/utils/assetValidation.js`.
2. Apply validation middleware to all AMM and DEX route parameters.
3. Reject malformed asset formats with descriptive 400 errors.
4. Add unit tests for valid and malformed asset identifier strings.

## Acceptance Criteria
- [ ] All AMM route parameters strictly validate asset code and issuer public keys.
- [ ] Invalid public keys or malformed codes return HTTP 400.
- [ ] Spoofed asset identifiers are blocked before database or Horizon queries.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1295](https://github.com/Ethereal-Future/FuTuRe/issues/1295)
