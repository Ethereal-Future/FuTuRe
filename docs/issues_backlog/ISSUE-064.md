# db/client.js: PostgreSQL connection pool size is hardcoded with no dynamic adjustment based on container CPU/memory constraints

**Domain:** Database & Persistence  
**Complexity:** Medium  
**Labels:** `enhancement`, `database`, `infrastructure`, `performance`  
**Issue ID:** ISSUE-064

---

## Background
In `backend/src/db/client.js`:
```javascript
const pool = new Pool({
  connectionString: adapterConnectionString,
  max: parseInt(process.env.DB_POOL_MAX, 10) || getConfig().database.poolMax || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
```
The pool size defaults to 10 connections per container.

## Problem
- If the ECS service auto-scales from 2 to 10 tasks under traffic spikes (per `infra/autoscaling.tf`), total client connections to PostgreSQL become 10 tasks * 10 connections = 100 connections.
- The RDS PostgreSQL instance configured in `infra/rds.tf` (`db.t4g.micro` or `db.t4g.small`) has a maximum connection limit of ~100-150 connections.
- Add background workers, migration tasks, and admin connections, and PostgreSQL quickly hits `FATAL: remaining connection slots are reserved for non-replication superuser connections`.
- There is no dynamic sizing or coordination with task counts.

## Proposed Solution
1. Document and configure connection sizing formula: `poolMax = Math.floor(RDS_MAX_CONNECTIONS * 0.7 / MAX_ECS_TASKS)`.
2. Enforce strict connection pooling through PgBouncer (which supports thousands of virtual client connections mapped to a small pool of physical connections).
3. Add connection pool metrics export (`active_connections`, `idle_connections`, `waiting_clients`) to Prometheus/OpenTelemetry.

## Implementation Steps
1. Add `poolMax` validation against container CPU count and expected task scale in `config/env.js`.
2. Configure PgBouncer in `infra/` to decouple task scaling from PostgreSQL physical connection limits.
3. Export `pg_pool_active_connections` and `pg_pool_waiting_queries` metrics.
4. Add alert when pool wait queue exceeds 5 requests.

## Acceptance Criteria
- [ ] Connection pool size is safely bounded under maximum auto-scaling scale.
- [ ] PgBouncer handles high client connection concurrency.
- [ ] PostgreSQL does not exceed connection limit during ECS scale-out.

## Notes
- **Complexity Rating:** Medium

**GitHub Issue:** [1311](https://github.com/Ethereal-Future/FuTuRe/issues/1311)
