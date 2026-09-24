# services/multiSig.js: addSignature requires plaintext signer private key over HTTP, completely compromising multi-sig security architecture

**Domain:** Multi-Sig & Authorization  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`, `cryptography`  
**Issue ID:** ISSUE-031

---

## Background
In `backend/src/services/multiSig.js`, `addSignature` accepts the signer's secret key (lines 157-177):
```javascript
export async function addSignature(txId, signerSecret) {
  const pending = await prisma.pendingMultiSigTx.findUnique({ where: { txId } });
  if (!pending) throw new Error(`Transaction ${txId} not found`);
  if (pending.status !== 'pending') throw new Error(`Transaction ${txId} is already ${pending.status}`);

  const signerKeypair = StellarSDK.Keypair.fromSecret(signerSecret);
  const signerPublicKey = signerKeypair.publicKey();
...
  const transaction = StellarSDK.TransactionBuilder.fromXDR(pending.txXdr, getNetworkPassphrase());
  transaction.sign(signerKeypair);
```
This is called from `backend/src/routes/multiSig.js` where the client submits `{ txId, signerSecret }` in an HTTP POST body.

## Problem
- The entire purpose of multi-signature security is distributed trust: no single party or central server should hold all the signing keys required to authorize a payment.
- By requiring signers to transmit their raw plaintext secret seed (`S...`) over HTTP to the backend server:
  1. The backend server holds every signer's private key in process memory and network transit.
  2. A compromised server, malicious insider, or logging middleware can capture all signer keys and forge arbitrary transactions without multi-sig consent.
  3. Non-custodial signers (e.g. hardware wallets like Ledger or browser extensions like Freighter/Albedo) cannot use this API because they never expose raw private keys to web applications.

## Proposed Solution
Refactor `addSignature` to accept either:
1. A client-signed transaction envelope XDR (`signedXdr`), OR
2. An ed25519 cryptographic signature (`signatureHex` / base64) along with `signerPublicKey`.
The backend reconstructs the transaction from `pending.txXdr`, cryptographically verifies the signature against the transaction hash and `signerPublicKey`, appends the signature to the transaction envelope using `transaction.signatures.push(...)`, and persists the updated XDR. Users sign locally in their browser or wallet; private keys NEVER leave the user's device.

## Implementation Steps
1. Change `addSignature` API parameters to `(txId, signedXdr)` or `(txId, { signerPublicKey, signature })`.
2. Verify the submitted signature against the transaction hash using `StellarSDK.Keypair.fromPublicKey(signerPublicKey).verify(transaction.hash(), signature)`.
3. Verify that `signerPublicKey` is a configured signer on the source account with non-zero weight.
4. Append the verified signature to the XDR envelope without requiring secrets on the server.
5. Update frontend multi-sig components to sign locally via Freighter/Albedo or client-side Keypair.
6. Add tests verifying signature aggregation without server-side secret keys.

## Acceptance Criteria
- [ ] No private keys or secret seeds are transmitted to or stored on the backend server.
- [ ] Signatures are generated client-side and cryptographically verified before storage.
- [ ] Transactions signed by multiple independent devices can be aggregated and submitted successfully.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1278](https://github.com/Ethereal-Future/FuTuRe/issues/1278)
