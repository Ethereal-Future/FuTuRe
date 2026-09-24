# services/streaming.js: Storing encrypted sender secrets at rest presents permanent key theft risk; needs delegation via pre-authorized transactions

**Domain:** Payment Streaming  
**Complexity:** Hard  
**Labels:** `enhancement`, `stellar`, `security`, `architecture`  
**Issue ID:** ISSUE-123

---

## Background
In `backend/src/services/streaming.js`, line 18 explicitly acknowledges:
```javascript
 * SECURITY MODEL:
 * - Each PaymentStream stores an encrypted senderSecret
 * - Secrets are encrypted at rest using STREAM_SECRET_ENCRYPTION_KEY
 * - Decryption happens only during payment processing
 * - This is an interim solution before full delegated signing
```
The sender's raw ed25519 secret key is encrypted with an AES-256-GCM symmetric key and saved in the database column `senderSecret`.

## Problem
- Storing encrypted private keys for recurring payments creates a high-value attack target:
  1. If `STREAM_SECRET_ENCRYPTION_KEY` and the database are compromised, an attacker decrypts the private keys of all streaming users and empties their Stellar accounts.
  2. Custodial secret storage violates core non-custodial crypto wallet security best practices.
  3. Stellar natively provides delegated signing mechanisms (pre-authorized transactions or dedicated escrow / allowance contracts) that eliminate the need to store user master private keys.

## Proposed Solution
Migrate to non-custodial delegated payment streaming:
1. **Option A (Stellar Native Allowance)**: The user creates a dedicated child/channel account funded with an allowance for the stream, or authorizes a platform signer with a strict low-threshold permission limited only to payment operations.
2. **Option B (Soroban Stream Contract)**: Deploy a Soroban recurring payment contract where users deposit allowance funds into contract escrow; the backend merely calls a permissionless `tick_stream(stream_id)` contract method without holding user private keys.
3. Deprecate and phase out storing `senderSecret` in PostgreSQL.

## Implementation Steps
1. Design delegated streaming architecture using Soroban smart contract escrow or low-weight channel signers.
2. Implement Soroban `StreamPayment` contract in `stellar-contract/`.
3. Update `createStream` to deploy stream escrow or fund channel account.
4. Refactor worker to trigger on-chain contract releases without private keys.
5. Safely purge `senderSecret` column from `PaymentStream` table.

## Acceptance Criteria
- [ ] Backend server does not store user private keys or secret seeds.
- [ ] Payment streaming executes via delegated smart contract escrow or channel keys.
- [ ] Key compromise cannot drain user primary account balances.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1370](https://github.com/Ethereal-Future/FuTuRe/issues/1370)
