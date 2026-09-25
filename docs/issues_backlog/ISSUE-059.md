# db/client.js: Long-running database transactions do not propagate client abort signals (AbortController), leaking DB locks on disconnected clients

**Domain:** Database & Persistence  
**Complexity:** Hard  
**Labels:** `enhancement`, `database`, `performance`, `backend`  
**Issue ID:** ISSUE-059

---

## Background
When a user cancels a long-running HTTP request (e.g. closing browser tab, navigating away, or client timeout), Express receives a `close` event on `req`.
In `backend/src/db/client.js` and Prisma queries across routes (`routes/transactions.js`, `routes/compliance.js`), queries and transactions do not link to the incoming request's `req.signal` / `req.on('close')`.

## Problem
- When an HTTP client aborts, the Node.js server continues executing the database transaction in the background until completion.
- Heavy analytical queries or complex batch writes consume CPU and hold row locks in PostgreSQL even though the requesting client has already disconnected.
- Under high load or network instability, orphaned queries accumulate, exhausting database connection pool limits.

## Proposed Solution
Pass `req.signal` through to Prisma operations where supported or listen to `req.on('close')` to cancel active database operations:
1. Create a request-scoped database context middleware that binds `req.signal` to queries.
2. In long-running transactions (`prisma.$transaction`), check `if (req.signal?.aborted) throw new RequestAbortedError()`.
3. Terminate backend queries via `SELECT pg_cancel_backend(pid)` if client cancels mid-execution.

## Implementation Steps
1. Create an abortable query wrapper in `backend/src/db/client.js`.
2. Attach `req.signal` to request context in `requestLogger` middleware.
3. In transaction routes, abort processing if client disconnects before commit.
4. Add tests verifying that client abort halts subsequent transaction steps.

## Acceptance Criteria
- [ ] Database queries and transactions abort promptly when HTTP client disconnects.
- [ ] Orphaned database locks from cancelled requests are eliminated.
- [ ] Connection pool availability improves under client timeout spikes.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1306](https://github.com/Ethereal-Future/FuTuRe/issues/1306)
