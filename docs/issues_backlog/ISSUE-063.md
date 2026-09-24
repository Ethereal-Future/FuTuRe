# db/migrate.js: Migration framework lacks distributed migration locking (advisory locks), leading to race conditions during parallel container startups

**Domain:** Database & Persistence  
**Complexity:** Hard  
**Labels:** `bug`, `database`, `infrastructure`, `devops`  
**Issue ID:** ISSUE-063

---

## Background
In `backend/src/db/migrate.js`, database migrations are executed at container boot via `applyMigrations()` or `prisma migrate deploy`.
When updating an ECS service with multiple tasks (`desired_count = 2+`), ECS launches new container tasks in parallel.

## Problem
- Both containers boot simultaneously and execute `applyMigrations()` against the shared PostgreSQL database at the exact same moment.
- If two processes concurrently execute `CREATE TABLE`, `ADD COLUMN`, or data migration scripts, PostgreSQL throws `ERROR: duplicate key value violates unique constraint "_prisma_migrations_pkey"` or deadlock errors on system catalogs.
- One container fails to boot and crashes, triggering unnecessary rollback alarms or leaving migration tracking in a corrupted `failed` state.

## Proposed Solution
Wrap migration execution in a PostgreSQL session-level advisory lock (`pg_advisory_lock`):
```javascript
const MIGRATION_LOCK_ID = 987654321;
await prisma.$executeRaw`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;
try {
  await runMigrations();
} finally {
  await prisma.$executeRaw`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
}
```
If another task holds the lock, wait with a timeout or skip execution if migrations are already marked complete.

## Implementation Steps
1. Add advisory locking in `backend/src/db/migrate.js` before applying pending migrations.
2. Check current migration version after acquiring lock to avoid duplicate execution.
3. Release lock in `finally` block.
4. Add test simulating two concurrent `migrate()` calls and asserting serialized clean execution.

## Acceptance Criteria
- [ ] Migrations are protected by distributed PostgreSQL advisory locks.
- [ ] Parallel container startups execute migrations safely without deadlock or duplicate key errors.
- [ ] Lock is guaranteed to release on error or crash.

## Notes
- **Complexity Rating:** Hard

**GitHub Issue:** [1310](https://github.com/Ethereal-Future/FuTuRe/issues/1310)
