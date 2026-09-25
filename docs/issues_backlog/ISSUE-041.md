# routes/multiSig.js: Missing cryptographic verification of client-signed XDR envelopes submitted via the signing API

**Domain:** Multi-Sig & Authorization  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`, `cryptography`  
**Issue ID:** ISSUE-041

---

## Background
When a client submits a signed transaction to `/api/multisig/sign` or updates XDR, the route parses the XDR using `StellarSDK.TransactionBuilder.fromXDR(xdr)`. However, it does not cryptographically verify whether the newly added signature is mathematically valid for the transaction's hash and network passphrase.

## Problem
- A malicious or buggy client can submit garbage bytes as a signature or submit a signature generated against a different transaction or network (e.g. Testnet signature submitted to Mainnet).
- The backend stores the corrupt signature in `pendingMultiSigTx`.
- When all signatures are gathered and the transaction is submitted to Horizon, Horizon fails with `tx_bad_auth`.
- Because the signature was never verified when received, it is impossible to identify which of the 3 signers submitted the invalid signature without manual cryptographic debugging.

## Proposed Solution
Upon receiving a signed XDR or signature payload in `addSignature`:
1. Calculate `txHash = transaction.hash()`.
2. Extract all attached signatures: `transaction.signatures`.
3. For each signature, verify against the matching signer public key using `keypair.verify(txHash, sig.signature())`.
4. If any signature fails cryptographic verification, reject the request with HTTP 400 `InvalidSignature: Signature verification failed for signer ${publicKey}`.

## Implementation Steps
1. Add signature validation utility in `backend/src/utils/cryptoVerification.js`.
2. In `addSignature`, iterate over transaction signatures and verify each against the transaction hash.
3. Check that the network passphrase used during signing matches the configured `STELLAR_NETWORK`.
4. Reject invalid signatures immediately with detailed error diagnostics.
5. Add tests with valid, invalid, and mismatched-network signatures.

## Acceptance Criteria
- [ ] Every signature is cryptographically verified against transaction hash prior to persistence.
- [ ] Invalid or forged signatures are rejected at submission time with 400 Bad Request.
- [ ] Malformed signatures cannot corrupt the pending transaction envelope.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1288](https://github.com/Ethereal-Future/FuTuRe/issues/1288)
