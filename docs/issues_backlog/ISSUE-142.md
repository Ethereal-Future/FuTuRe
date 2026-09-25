# recovery/recoveryWorkflow.js: completeRecovery updates status to completed but never executes key rotation or Stellar setOptions signer updates

**Domain:** Account Recovery & Custody  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`  
**Issue ID:** ISSUE-142

---

## Background
In `backend/src/recovery/recoveryWorkflow.js`:
```javascript
export function completeRecovery(requestId) {
  const request = recoveryRequests.get(requestId);
  if (!request) throw new Error('Recovery request not found');
  if (request.status !== 'approved') throw new Error('Recovery not approved');
  if (new Date() < new Date(request.executeAfter)) {
    throw new Error('Time-lock active...');
  }

  request.status = 'completed';
  request.completedAt = new Date().toISOString();
  return request;
}
```

## Problem
- `completeRecovery` merely marks `status = 'completed'` on an in-memory object.
- It DOES NOT:
  1. Generate a new keypair or accept a new public key from the recovered user.
  2. Execute a Stellar on-chain `setOptions` transaction to replace the old lost master signer with the new key.
  3. Reset the user's password or revoke old active JWT sessions.
  4. Notify the user via out-of-band channels that recovery has concluded.
- The user has waited 24 hours for the time-lock to expire, only to find their account key on the blockchain was never updated, leaving them still locked out!

## Proposed Solution
1. Require the recovered user to supply a `newPublicKey` (generated locally on their new device) when initiating or completing recovery.
2. When the time-lock expires and `completeRecovery` is called:
   - Construct an on-chain transaction adding `newPublicKey` as a signer and removing/zeroing the compromised `oldPublicKey` signer via `Operation.setOptions`.
   - Submit the transaction to Stellar.
   - Revoke all existing sessions and refresh tokens for `userId`.
   - Update `user.publicKey = newPublicKey` in PostgreSQL.
   - Dispatch security notifications confirming successful recovery.

## Implementation Steps
1. Add `newPublicKey` parameter to recovery initiation and completion workflows.
2. Implement on-chain key rotation transaction in `backend/src/services/keypairRotation.js`.
3. Revoke all previous user sessions upon recovery completion.
4. Dispatch confirmation notifications to user's verified contact channels.
5. Add end-to-end integration test verifying on-chain signer replacement upon recovery completion.

## Acceptance Criteria
- [ ] Recovery completion updates the on-chain Stellar account signers via `setOptions`.
- [ ] Old sessions and tokens are revoked.
- [ ] The recovered user can immediately authenticate and transact with their new keypair.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1389](https://github.com/Ethereal-Future/FuTuRe/issues/1389)
