# services/assetRegistry.js: Asset verification service does not cryptographically verify TOML signing keys against issuer home domains

**Domain:** Stellar Blockchain Services  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`, `backend`  
**Issue ID:** ISSUE-029

---

## Background
`backend/src/services/assetRegistry.js` catalogs verified Stellar assets, validating asset codes and issuer account addresses. Stellar SEP-1 specifies that authentic issuers publish a `SIGNING_KEY` in their `stellar.toml` and set the `HOME_DOMAIN` on their issuing account.

## Problem
- The asset registry verifies whether an asset exists in Horizon, but does not cryptographically verify that the issuing account on-chain has set its `HOME_DOMAIN` to the expected domain and that the `stellar.toml` is signed by that account's key.
- An attacker can issue a fraudulent token with code `USDC` or `EURC` and submit it to the registry. If verification only checks asset code existence, malicious copycat assets can be listed alongside genuine stablecoins, enabling phishing and theft.

## Proposed Solution
Implement full SEP-1 cryptographic verification in `assetRegistry.js`:
1. Load issuer account from Horizon and retrieve `home_domain`.
2. Fetch `https://${home_domain}/.well-known/stellar.toml`.
3. Verify that the TOML declares the asset code and issuing public key.
4. Verify that the TOML is signed with `SIGNING_KEY` matching the domain or issuer.
5. Reject assets that fail two-way domain verification.

## Implementation Steps
1. Add `verifyIssuerDomain(assetCode, issuerPublicKey)` in `assetRegistry.js`.
2. Verify reciprocal linking: on-chain `home_domain` points to domain, and domain's `stellar.toml` lists issuer key.
3. Verify ed25519 signature of the `stellar.toml` file against `SIGNING_KEY`.
4. Add test verifying rejection of spoofed assets with mismatched home domains.

## Acceptance Criteria
- [ ] Asset registry only verifies assets with valid bidirectional SEP-1 home domain verification.
- [ ] Copycat assets with unverified issuers are rejected.
- [ ] Cryptographic signature check prevents DNS spoofing attacks.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1276](https://github.com/Ethereal-Future/FuTuRe/issues/1276)
