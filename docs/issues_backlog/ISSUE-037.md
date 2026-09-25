# services/multiSig.js: Missing support for pre-authorized transaction hash signers (SignerType.preAuthTx) and hash(x) signers

**Domain:** Multi-Sig & Authorization  
**Complexity:** Medium  
**Labels:** `enhancement`, `stellar`, `defi`  
**Issue ID:** ISSUE-037

---

## Background
In `backend/src/services/multiSig.js`, `createMultiSigAccount` only supports ed25519 public key signers (lines 45-54):
```javascript
for (const signer of signers) {
  txBuilder.addOperation(
    StellarSDK.Operation.setOptions({
      signer: {
        ed25519PublicKey: signer.publicKey,
        weight: signer.weight,
      },
    })
  );
}
```

## Problem
- Stellar natively supports three types of signers:
  1. `ed25519PublicKey`: Standard keypair signers.
  2. `preAuthTx`: Pre-authorized transaction hash signers (used for dead-man switches, atomic escrows, and recurring automatic transactions).
  3. `sha256Hash`: Hash(x) preimage signers (used for cross-chain atomic swaps / HTLCs and lightning-style payment channels).
- The current implementation rejects or crashes on `preAuthTx` and `sha256Hash` signer types because it assumes all signers are ed25519 public keys.
- This prevents the platform from supporting automated recovery workflows, escrow time-locks, and atomic swaps.

## Proposed Solution
Extend `createMultiSigAccount` and `addSigner` to support all three Stellar signer types by discriminating on a `signerType` field (`'ed25519' | 'preAuthTx' | 'sha256Hash'`):
- For `preAuthTx`: pass `signer: { preAuthTx: signer.hash, weight: signer.weight }`.
- For `sha256Hash`: pass `signer: { sha256Hash: signer.hash, weight: signer.weight }`.

## Implementation Steps
1. Update signer input validation schema to accept `type: 'ed25519' | 'preAuthTx' | 'hash'`.
2. Format `Operation.setOptions` signer object appropriately according to type.
3. Add documentation and examples for setting up pre-authorized escrows.
4. Add integration tests verifying `preAuthTx` and `sha256Hash` signer configuration on testnet.

## Acceptance Criteria
- [ ] All three native Stellar signer types are supported in multi-sig creation.
- [ ] Signer configuration options are validated with appropriate schemas.
- [ ] Atomic swaps and pre-authorized transactions can be configured.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1284](https://github.com/Ethereal-Future/FuTuRe/issues/1284)
