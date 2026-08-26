# Runbook: Database Failover

## Overview

The backend uses PostgreSQL via Prisma, optionally fronted by PgBouncer in
transaction-pooling mode (`DATABASE_POOL_URL`, see
`backend/CONFIGURATION.md` §"Database connection pooling"). `DATABASE_URL`
is the direct connection used for migrations and health checks; if
`DATABASE_POOL_URL` is set, Prisma uses it for all normal query traffic.

This runbook covers promoting a standby/replica to primary and repointing
the application at it when the primary instance is unhealthy, unreachable,
or needs to be taken down for maintenance. The exact promotion mechanics
depend on how Postgres is hosted:

- **Managed Postgres** (RDS, Cloud SQL, Supabase, etc.) — use the provider's
  console/CLI to trigger failover to a standby; this runbook covers the
  application-side steps that follow.
- **Self-managed streaming replication** — promotion is a `pg_ctl promote`
  (or `pg_promote()`) on the replica; coordinate with whoever owns the
  Postgres infrastructure if that isn't you.

If there is no standby/replica provisioned at all, this runbook doesn't
apply — see the [Database Backup Restore Procedure](../runbook.md#6-database-backup-restore-procedure)
instead, and treat provisioning a standby as a follow-up.

## Indicators

- `GET /health` or `GET /health/ready` reports the `database` check as
  `unhealthy`, or the app fails to start with a Prisma connection error
  (`P1001: Can't reach database server`).
- API requests failing with 500s and logs showing
  `PrismaClientKnownRequestError` / `PrismaClientInitializationError`.
- Your infrastructure monitoring (RDS/Cloud SQL events, `pg_isready`, or a
  synthetic query check) reports the primary as down or failing over.
- Elevated connection errors from PgBouncer if `DATABASE_POOL_URL` is
  configured (`pgbouncer.ini` logs show repeated connect failures to the
  backend).

## Immediate mitigation

1. **Confirm the primary is actually down** before promoting anything —
   promoting a standby while the old primary is still writable risks a
   split-brain (two writable databases diverging). Check from the app host:
   ```bash
   pg_isready -d "$DATABASE_URL"
   ```
2. **Put the app in a degraded/maintenance stance if writes must stop
   immediately.** There is no built-in maintenance-mode flag; the fastest
   safe option is to stop the backend process so it isn't writing against a
   database that's about to change under it:
   ```bash
   kill $(lsof -ti tcp:3001)
   ```
   Skip this step if the primary is already fully unreachable (nothing is
   writing successfully anyway).
3. **Promote the standby** using your hosting provider's mechanism:
   - Managed Postgres: trigger failover from the provider console/CLI (e.g.
     `aws rds failover-db-cluster` for Aurora, or the Cloud SQL failover
     button). This usually also updates a stable endpoint DNS name for you —
     check whether `DATABASE_URL` already points at that stable endpoint
     rather than an instance-specific hostname, since that determines
     whether step 4 is even necessary.
   - Self-managed: `pg_ctl promote -D /path/to/data` on the replica (or
     `SELECT pg_promote();` if run via `psql` against Postgres 12+).
4. **Confirm the new primary accepts writes:**
   ```bash
   psql "<new-primary-connection-string>" -c "SELECT pg_is_in_recovery();"
   # Expect: f (false) — a promoted primary is no longer "in recovery"
   ```

## Root cause investigation

- Check the old primary's logs (or your hosting provider's event history)
  for what caused the failure: OOM kill, disk full, a bad migration, a
  hardware/AZ failure, or a manual maintenance action someone forgot to
  announce.
- If it was disk space: check for unbounded table growth — this project's
  `Transaction`, `RetryAttempt`, and `AuditLog`-style tables are the most
  write-heavy; confirm any retention/archival jobs actually ran.
- If it was connection exhaustion: check whether `DATABASE_POOL_URL`
  (PgBouncer) was actually in front of traffic — direct-to-Postgres
  connections from many backend instances without pooling is a common
  cause.
- If it was a bad migration: do **not** immediately re-run
  `prisma migrate deploy` against the new primary until you've confirmed
  which migrations already applied there (see Resolution step 2) — replaying
  a partially-applied migration can error out or, worse, silently diverge
  from what actually happened on the old primary before failover.

## Resolution

1. **Update connection strings** in the backend environment to point at the
   new primary (skip if your provider kept the same DNS endpoint and just
   repointed it under the hood):
   ```bash
   # backend/.env (or your secrets manager)
   DATABASE_URL=postgresql://user:password@<new-primary-host>:5432/future_remittance
   DATABASE_POOL_URL=postgresql://user:password@<pgbouncer-host>:6432/future_remittance
   ```
   If you run PgBouncer yourself, also update its backend target in
   `pgbouncer.ini` and reload it (`pgbouncer -R` or `SIGHUP`) — otherwise
   pooled connections keep going to the old (now-standby or dead) instance.
2. **Verify migration state matches expectations** before resuming traffic:
   ```bash
   cd backend
   DATABASE_URL="<new-primary>" npx prisma migrate status
   ```
   If the new primary is missing migrations the old primary had (replication
   lag at the moment of failure), apply them:
   ```bash
   DATABASE_URL="<new-primary>" npx prisma migrate deploy
   ```
3. **Restart the backend** to pick up the new connection strings:
   ```bash
   cd backend
   node src/server.js &
   ```
4. **Verify full connectivity:**
   ```bash
   curl -f http://localhost:3001/health/ready
   psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"User\";"
   ```
5. **Provision a new standby** replicating from the new primary as soon as
   practical — running without one leaves you exposed to a repeat incident
   with no failover target.

## Escalation path

- If failover requires provider support (e.g. a managed-Postgres outage that
  their automated failover didn't resolve), open a support ticket with your
  hosting provider immediately in parallel with the steps above — don't wait
  for it to fail before escalating.
- If replication lag at the moment of failure means recent writes were lost
  (the new primary is missing transactions the old one had), escalate to
  engineering leadership before deciding on write-loss handling — this may
  need customer communication if it affected payment records.
- If no standby exists and the primary's disk/data is unrecoverable,
  escalate immediately and move to the
  [Database Backup Restore Procedure](../runbook.md#6-database-backup-restore-procedure).

## Post-incident actions

- [ ] Confirm a standby is replicating from the new primary.
- [ ] Confirm `DATABASE_URL`/`DATABASE_POOL_URL` are updated consistently
      across every environment and deployment target, not just the instance
      you patched live.
- [ ] Reconcile any writes that may have been lost due to replication lag —
      check `Transaction`, `RetryAttempt`, and `PaymentStream` tables for
      gaps around the failover timestamp.
- [ ] If the root cause was disk space or connection exhaustion, file a
      follow-up for capacity planning or PgBouncer adoption.
- [ ] Write a post-mortem within 48 hours per `docs/runbook.md` §5.5.
