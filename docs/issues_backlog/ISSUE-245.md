# backend/src/routes/stellar/sep31.js: Missing requireAuth middleware on cross-border transaction submission

**Domain:** Backend & Security  
**Complexity:** High  
**Labels:** `bug`, `security`, `stellar`, `sep-31`  
**Issue ID:** ISSUE-245

---

## Background
`backend/src/routes/stellar/sep31.js` is mounted at `/api/stellar/sep31` and proxies SEP-31 (cross-border payments) calls to receiving anchors:

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/info` | Discover an anchor's SEP-31 server and supported assets |
| `POST` | `/transactions` | Create a cross-border transaction on the anchor (`amount`, `assetCode`, `senderId`, `receiverId`, `fields`) |
| `GET` | `/transactions/:id` | Poll the status of a transaction on the anchor |

None of these routes applies `requireAuth` (`backend/src/middleware/auth.js`). They only use `express-validator` rules and `validate`.

## Problem
- **Unauthenticated submission:** anyone who can reach the API can create transactions on a receiving anchor through the platform's own anchor credentials and reputation.
- **PII exposure:** `GET /transactions/:id` returns anchor data that can include sender and receiver KYC fields. With no auth, anyone who knows or guesses an ID can poll it.
- **No ownership:** transactions are not linked to the user who created them, so even with auth added, any user could read any other user's transaction.

## Proposed Solution
- Add `requireAuth` to `POST /transactions` and `GET /transactions/:id`.
- Record the creating user against each anchor transaction ID, and only let the owner poll it.
- `GET /info` returns only public anchor metadata, so it can stay public. It should still be rate-limited.

## Implementation Steps
1. Import `requireAuth` from `../../middleware/auth.js` and place it first in the middleware chain for `POST /transactions` and `GET /transactions/:id`, before validation.
2. On a successful `POST /transactions`, store `{ anchorUrl, anchorTransactionId, userId, createdAt }` (Prisma model or an existing transaction table).
3. In `GET /transactions/:id`, look up the stored record and return `404` when it does not exist or belongs to another user. Do not return `403`, which would confirm that the ID exists.
4. Update the Swagger blocks to declare `security: [{ bearerAuth: [] }]` and document the `401` response.
5. Add route tests: no token → `401`, expired or invalid token → `401`, valid token → `200`/`201`, another user's ID → `404`.

## Acceptance Criteria
- [ ] Unauthenticated requests to `/api/stellar/sep31/transactions` (POST) and `/api/stellar/sep31/transactions/:id` (GET) return `401 Unauthorized`.
- [ ] Authenticated users can submit and monitor their own cross-border remittances.
- [ ] Users cannot poll transactions they did not create.

## Notes
- **Complexity Rating:** High

**GitHub Issue:** [1559](https://github.com/Ethereal-Future/FuTuRe/issues/1559)
