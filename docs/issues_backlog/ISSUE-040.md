# services/multiSig.js: PendingMultiSigTx records lack cleanup job for expired uncollected transactions, resulting in database clutter

**Domain:** Multi-Sig & Authorization  
**Complexity:** Medium  
**Labels:** `bug`, `stellar`, `database`  
**Issue ID:** ISSUE-040

---

## Background
In `backend/src/services/multiSig.js`, every pending multi-sig transaction sets an `expiresAt` timestamp (default 5 minutes in line 129):
```javascript
const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
await prisma.pendingMultiSigTx.create({
  data: { txId, txXdr, status: 'pending', expiresAt, ... }
});
```
However, there is no background cron job or scheduled task that updates the status of expired rows or purges abandoned records.

## Problem
- Transactions that never gathered sufficient signatures remain with `status: 'pending'` indefinitely in PostgreSQL.
- Queries fetching pending transactions (`listPendingTransactions`) return expired, unexecutable transactions that clutter user dashboards.
- Over time, thousands of dead transaction envelopes accumulate in the database, degrading query performance on the `pendingMultiSigTx` table.

## Proposed Solution
1. Add an index on `(status, expiresAt)` in Prisma schema.
2. In `listPendingTransactions`, filter for `status: 'pending'` AND `expiresAt: { gt: new Date() }`.
3. Add a scheduled cleanup task `cleanupExpiredMultiSigTransactions()` in `backend/src/scheduler.js` running every 10 minutes:
```javascript
await prisma.pendingMultiSigTx.updateMany({
  where: { status: 'pending', expiresAt: { lte: new Date() } },
  data: { status: 'expired' }
});
```

## Implementation Steps
1. Add index `@@index([status, expiresAt])` to `PendingMultiSigTx` model.
2. Update query filters in `routes/multiSig.js` to exclude expired transactions.
3. Add scheduled worker function to transition expired rows to 'expired'.
4. Add unit tests verifying expired transactions are marked and excluded from active listings.

## Acceptance Criteria
- [ ] Expired transactions automatically transition to 'expired' status.
- [ ] Active pending queries return only non-expired transactions.
- [ ] Database table remains clean and indexed.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1287](https://github.com/Ethereal-Future/FuTuRe/issues/1287)
