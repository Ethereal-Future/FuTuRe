# Runbook: Stuck Transaction Recovery

## Overview

A "stuck" transaction is one where the platform's local state doesn't match
(or doesn't yet know) the transaction's actual outcome on the Stellar
network. This happens because Horizon submission is not always a clean
success/failure round trip — the backend can crash, time out, or hit a
retryable Horizon error after broadcasting a transaction but before
confirming whether it landed. Because Stellar transactions are atomic and
idempotent per sequence number, the transaction did, in fact, either succeed
or fail on-chain — the job here is finding out which, not guessing.

Relevant code: `sendPayment`/`mergeAccount`/`updateTrustlineLimit` etc. in
`backend/src/services/stellar.js` (single-shot submissions, each wrapped in
`withHorizonRetry`), `backend/src/services/pathPayment.js` (`sendPathPayment`),
`backend/src/services/transactionRetry.js` (the retry/circuit-breaker
wrapper used by `POST /api/retry/transaction`, see `backend/src/routes/retry.js`),
and the `Transaction`/`RetryAttempt` Prisma models.

**Important:** `TransactionRetryService`'s retry-attempt history is
in-memory per process (`backend/src/routes/retry.js` constructs
`new TransactionRetryService()` at module load) — it does not survive a
backend restart. Don't rely on it as the source of truth for "did this
transaction actually happen"; Horizon is the source of truth.

## Indicators

- A user reports a payment/action didn't complete, but they also don't see
  an error — or they see one but funds still appear to have moved.
- `Transaction.retryStatus` is non-null / `retryAttempts > 0` for a record
  with no clear terminal outcome.
- Logs show a Horizon call was made (`stellar.*.start` or similar) but no
  matching `*.success` or `*.failed` log line followed — consistent with the
  process crashing or being killed mid-request.
- `GET /api/retry/attempts/:transactionId` shows attempts but the caller is
  unsure whether the *last* attempt actually reached Horizon or timed out
  client-side before a response came back.
- A known Stellar error code surfaced to the user that specifically implies
  ambiguity, most notably `tx_bad_seq` (see `backend/src/utils/stellarErrors.js`)
  — this occurs when the account's sequence number has already advanced,
  which can mean a *different* submission using that sequence number already
  succeeded.

## Immediate mitigation

1. **Do not blindly resubmit** a payment for the same intent (same sender,
   recipient, amount) without first confirming the original didn't land —
   Stellar has no built-in idempotency key for payments, so a naive retry
   can result in a duplicate transfer.
2. If the user is asking "did my payment go through", check their current
   balance/transaction history first (`GET` balance or transaction-history
   endpoints) — often the fastest answer, since a successful payment will
   already be reflected there even if the app's own `Transaction` record is
   stale.

## Root cause investigation

1. **Find the transaction hash.** If you have it (from logs, the `Transaction`
   table, or the user), skip to step 2. If you only have "the payment sent
   around HH:MM from account G...", list recent Horizon transactions for
   that account instead:
   ```bash
   cd backend
   node --input-type=module <<'EOF'
   import { getHorizonServer } from './src/services/stellar.js';
   const records = await getHorizonServer()
     .transactions()
     .forAccount('<GSENDER...>')
     .order('desc')
     .limit(10)
     .call();
   records.records.forEach(tx =>
     console.log(tx.created_at, tx.hash, tx.successful, tx.operation_count)
   );
   EOF
   ```
2. **Look up the transaction by hash directly on Horizon** — this is the
   definitive answer to "did it happen":
   ```bash
   curl -s "$HORIZON_URL/transactions/<HASH>" | jq '{successful, ledger, created_at, fee_charged}'
   ```
   - **404** — the transaction was never included in a ledger. It did not
     happen on-chain. Safe to resubmit (with a fresh sequence number, which
     `sendPayment` etc. will fetch automatically via `loadAccount`).
   - **200, `successful: true`** — it happened. Do not resubmit. Reconcile
     the local `Transaction` record (see Resolution step 1).
   - **200, `successful: false`** — it was included in a ledger but failed
     (e.g. an inner operation failed). Check `result_xdr` for the specific
     operation error before deciding whether to resubmit — a failed
     transaction still consumed the sequence number and a fee, but moved no
     funds.
3. **If the hash is unknown and the account's sequence number looks ahead of
   what your local state expects** (a `tx_bad_seq` error is the tell), the
   account has a transaction your records don't know about — go back to
   step 1's list-by-account approach to find it rather than guessing.
4. **Check for a matching `RetryAttempt` record** to see how many attempts
   were made and their recorded error types:
   ```bash
   cd backend
   node --input-type=module <<'EOF'
   import prisma from './src/db/client.js';
   const attempts = await prisma.retryAttempt.findMany({
     where: { transaction: { hash: '<HASH-OR-KNOWN-ID>' } },
     orderBy: { attemptNumber: 'asc' },
   });
   console.log(attempts);
   await prisma.$disconnect();
   EOF
   ```

## Resolution

**If Horizon confirms the transaction succeeded** but the local `Transaction`
record is missing or marked unsuccessful, reconcile it rather than
resubmitting:

```bash
cd backend
node --input-type=module <<'EOF'
import prisma from './src/db/client.js';
await prisma.transaction.updateMany({
  where: { hash: '<HASH>' },
  data: { successful: true, retryStatus: 'reconciled' },
});
await prisma.$disconnect();
EOF
```

If no `Transaction` row exists at all for a hash Horizon confirms succeeded
(e.g. the DB write in `sendPayment`/`sendPathPayment` never ran before the
process died), you'll need to backfill one with the sender/recipient/amount
from the Horizon operation record — check the `enrichTransaction`/`storeTransactions`
logic in `backend/src/services/transactions.js` for the expected shape.

**If Horizon confirms the transaction never happened (404)**, it's safe to
resubmit. For a payment already known to the platform, use the existing
retry endpoint rather than crafting a new transaction by hand:

```bash
curl -X POST http://localhost:3001/api/retry/transaction \
  -H "Authorization: Bearer <caller-token>" \
  -H "Content-Type: application/json" \
  -d '{ "transactionHash": "<original-hash-or-tracking-id>" }'
```

**If the transaction failed on-chain** (200, `successful: false`), decode
`result_xdr` to find the specific operation error (insufficient balance,
trustline missing, offer cross issue, etc.), fix the underlying condition if
one exists, and resubmit through the normal payment flow — not the retry
endpoint, since this was a definitive failure rather than an ambiguous one.

## Escalation path

- If Horizon itself is unreachable while you're trying to determine a
  transaction's outcome, this becomes a [Horizon outage](horizon-outage.md)
  situation first — you cannot safely resolve ambiguity without querying
  Horizon, so don't guess in the meantime.
- If you find evidence of a duplicate transfer (the same intent submitted
  twice and both landed on-chain), escalate to engineering leadership and
  finance/ops immediately — this needs a compensating transaction and likely
  user communication, not just a data-record fix.
- If the affected account belongs to a high-value or KYC-flagged user,
  loop in the on-call lead before taking any resolution action.

## Post-incident actions

- [ ] Confirm the local `Transaction` record now matches Horizon's recorded
      outcome for every hash investigated.
- [ ] If the root cause was a backend crash/restart mid-submission, check
      whether it was a one-off (deploy, OOM) or something recurring —
      recurring crashes at exactly this point in the payment flow deserve
      their own investigation.
- [ ] Consider whether the affected flow should record "submission started"
      state *before* calling Horizon (rather than only recording success or
      failure) so future incidents are easier to diagnose without manual
      Horizon archaeology.
- [ ] Write a post-mortem within 48 hours per `docs/runbook.md` §5.5 if any
      user-visible fund discrepancy was involved.
