# db/client.js: PgBouncer transaction pooling mode breaks pool.on('connect') statement_timeout persistence across borrowed connections

**Domain:** Database & Persistence  
**Complexity:** Hard  
**Labels:** `bug`, `database`, `infrastructure`, `backend`  
**Issue ID:** ISSUE-057

---

## Background
In `backend/src/db/client.js`:
```javascript
// Layer 1 — PostgreSQL server-side timeout.
pool.on('connect', (client) => {
  client
    .query(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`)
    .catch((err) => logger.error('db.statement_timeout.set.failed', { error: err.message }));
});
```
The file also explicitly documents PgBouncer transaction pooling mode support: `const usePgBouncer = Boolean(process.env.DATABASE_POOL_URL);`.

## Problem
- In PgBouncer **transaction pooling mode** (the default recommended mode for RDS / ECS high-concurrency deployments), a client acquires a physical backend connection for only the duration of a single transaction or statement, after which the connection is returned to the pool and loaned to a different client.
- `SET statement_timeout` executed on initial client connection (`pool.on('connect')`) sets a session-level parameter on the physical connection.
- When PgBouncer returns the connection to its pool or when it resets session state (`DISCARD ALL` or `RESET ALL`), `statement_timeout` is reset to PostgreSQL default (0 / no timeout).
- Furthermore, if `DISCARD ALL` is disabled in PgBouncer, `SET statement_timeout` leaks into other clients' transactions unpredictably.
- As a result, long-running queries in transaction pooling mode run without server-side timeout protection, hanging database backends.

## Proposed Solution
1. For PgBouncer transaction pooling, configure `statement_timeout` in the connection string parameters: `?options=-c%20statement_timeout%3D${QUERY_TIMEOUT_MS}` or via `DATABASE_URL` query parameters so it applies to every connection startup packet.
2. In AWS RDS, configure `statement_timeout = 5000` in the PostgreSQL DB Parameter Group for the database cluster.
3. Validate connection string query parameters in `buildConnectionString` to ensure options are propagated.

## Implementation Steps
1. In `buildConnectionString(url)` in `client.js`, append `options=-c statement_timeout=${QUERY_TIMEOUT_MS}` to the query parameters.
2. Update `infra/rds.tf` parameter group to enforce default `statement_timeout = 5000` globally.
3. Verify behavior with PgBouncer transaction mode under simulated slow queries.
4. Add integration test verifying statement timeout triggers on queries exceeding 5,000ms.

## Acceptance Criteria
- [ ] `statement_timeout` is enforced on every query under PgBouncer transaction pooling.
- [ ] Server-side timeouts protect against runaway queries.
- [ ] Configuration persists across connection resets.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1304](https://github.com/Ethereal-Future/FuTuRe/issues/1304)
