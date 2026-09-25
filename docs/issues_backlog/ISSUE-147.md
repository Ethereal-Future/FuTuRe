# recovery/recoveryStore.js: Sharded recovery shares (Shamir's Secret Sharing) lack threshold verification before reconstructing master secrets

**Domain:** Account Recovery & Custody  
**Complexity:** Hard  
**Labels:** `bug`, `cryptography`, `security`  
**Issue ID:** ISSUE-147

---

## Background
In `backend/src/recovery/recoveryStore.js`, Shamir's Secret Sharing (SSS) is used to split recovery phrases into M-of-N shares across trusted contacts:
```javascript
export function reconstructSecret(shares) {
  return sss.combine(shares);
}
```

## Problem
- `reconstructSecret` does not verify:
  1. That the number of provided shares meets the required threshold M: `if (shares.length < threshold)`.
  2. That the shares belong to the SAME secret generation epoch (shares from epoch 1 mixed with shares from epoch 2 produce corrupted garbage).
  3. That the shares have not been tampered with or corrupted (no cryptographic MAC or hash verification on shares).
- Passing corrupted or mismatched shares to `sss.combine` generates a false reconstructed key with no error thrown!
- The user believes recovery succeeded, but the derived key does not match their on-chain account, leaving them permanently stranded.

## Proposed Solution
Implement Verifiable Secret Sharing (VSS) or wrap shares in cryptographic envelopes:
1. Store a SHA-256 hash or public key fingerprint of the original secret alongside share metadata: `expectedPublicKeyFingerprint`.
2. Add metadata to each share: `{ shareIndex, threshold, epochId, shareData, hmac }`.
3. In `reconstructSecret`, verify all shares have identical `epochId` and `threshold`, and assert `shares.length >= threshold`.
4. After reconstruction, derive the public key and assert it strictly matches `expectedPublicKeyFingerprint`. If mismatched, throw `CorruptedSharesError`.

## Implementation Steps
1. Implement share envelope structure with `epochId`, `threshold`, and integrity check.
2. Verify threshold and epoch consistency in `reconstructSecret`.
3. Validate reconstructed secret against stored public key fingerprint.
4. Add unit tests with mismatched epochs, insufficient shares, and corrupted share bytes.

## Acceptance Criteria
- [ ] Reconstruction requires meeting the exact M-of-N threshold.
- [ ] Mismatched or corrupted shares are detected and rejected with clear errors.
- [ ] Secret reconstruction is cryptographically verified before returning.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1394](https://github.com/Ethereal-Future/FuTuRe/issues/1394)
