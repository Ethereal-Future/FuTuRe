# routes/multiSig.js: Endpoints lack authorization checks verifying whether caller public key belongs to the transaction's configured signers

**Domain:** Multi-Sig & Authorization  
**Complexity:** Hard  
**Labels:** `bug`, `stellar`, `security`, `backend`  
**Issue ID:** ISSUE-036

---

## Background
`backend/src/routes/multiSig.js` exposes routes `/api/multisig/transactions`, `/api/multisig/:txId`, `/api/multisig/sign`, and `/api/multisig/submit`.
The routes verify that the user is authenticated via JWT (`requireAuth`), but do not verify whether the authenticated user is the source account owner or an authorized signer of the transaction.

## Problem
- Any authenticated user on the platform can call `GET /api/multisig/:txId` and inspect another user's pending multi-sig transaction, destination, amount, and accumulated signatures (IDOR / data disclosure).
- Any authenticated user can call `POST /api/multisig/submit` for ANY pending transaction ID in the database, triggering execution prematurely.
- Any authenticated user can call `DELETE /api/multisig/:txId` or cancel transactions they do not own or participate in.

## Proposed Solution
Implement an authorization middleware `requireMultiSigParticipant` for multi-sig routes:
1. Load `pendingMultiSigTx` and fetch its `sourcePublicKey`.
2. Verify that `req.user.publicKey` is either the `sourcePublicKey` OR is listed in the account's signers from Horizon / `pending.signers`.
3. If the caller's public key is not an authorized participant, return HTTP 403 Forbidden.

## Implementation Steps
1. Create `requireMultiSigParticipant` middleware in `backend/src/middleware/multiSigAuth.js`.
2. Apply middleware to `GET /:txId`, `POST /sign`, `POST /submit`, and `DELETE /:txId`.
3. Ensure users can only view pending transactions where their public key is the source or a designated signer.
4. Add security tests verifying unauthorized users receive 403 Forbidden.

## Acceptance Criteria
- [ ] Users cannot view or interact with multi-sig transactions they are not participants in.
- [ ] IDOR vulnerability is closed across all multi-sig endpoints.
- [ ] Authorization unit and integration tests pass.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1283](https://github.com/Ethereal-Future/FuTuRe/issues/1283)
