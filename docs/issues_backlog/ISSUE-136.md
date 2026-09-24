# mobile/auth.js: Biometric re-authentication bypass: endpoints accept cached client tokens without requiring fresh hardware-backed signatures

**Domain:** Mobile & Offline Resilience  
**Complexity:** Hard  
**Labels:** `bug`, `mobile`, `security`, `cryptography`  
**Issue ID:** ISSUE-136

---

## Background
In `backend/src/mobile/auth.js`, high-value payments (e.g. transfers > 100 XLM) require biometric re-authentication.
The endpoint `/api/mobile/auth/biometric-confirm` accepts a `biometricAuthToken` from the client.

## Problem
- Once a user completes biometric authentication, the server issues a `biometricAuthToken` that remains valid for 15 minutes.
- If a phone is stolen while unlocked or if malware compromises the app, the cached `biometricAuthToken` can be used to authorize multiple consecutive large payments without ever prompting the user for FaceID/TouchID again!
- Biometric re-authentication should be bound to a SPECIFIC transaction hash and amount, not a reusable general-purpose session token.

## Proposed Solution
Implement Transaction-Bound Biometric Signatures:
1. The server generates a payment authorization challenge containing `(transactionHash, amount, destination, timestamp)`.
2. The mobile device signs this specific challenge using the Secure Enclave / Android Keystore private key unlocked by biometrics.
3. The server verifies the signature against the registered public key for THAT SPECIFIC transaction.
4. The challenge is one-time use and cannot be used to authorize any other transaction.

## Implementation Steps
1. Refactor biometric confirmation to sign transaction payloads rather than issuing generic tokens.
2. Bind cryptographic signature verification to the transaction's parameters.
3. Invalidate the biometric challenge immediately upon payment execution.
4. Add tests verifying that a biometric signature for transaction A cannot authorize transaction B.

## Acceptance Criteria
- [ ] Biometric authorization is cryptographically bound to exact transaction parameters.
- [ ] Reusable biometric tokens are eliminated.
- [ ] Malware cannot reuse previous biometric authorizations for new transactions.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1383](https://github.com/Ethereal-Future/FuTuRe/issues/1383)
