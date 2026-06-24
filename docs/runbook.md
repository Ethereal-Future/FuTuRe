# Operational Runbook

Common operational procedures for the Stellar Remittance Platform backend.

**Prerequisites:** SSH access to the server, a copy of the production `.env` file, and `DATABASE_URL` available in your shell.

---

## 1. Server Restart

The backend is a Node.js/Express process started from the `backend/` directory.

```bash
# Find and stop the running process
kill $(lsof -ti tcp:3001)

# Start in the background (production)
cd backend
node src/server.js &

# Or with PM2 (if configured)
pm2 restart future-backend
```

Verify recovery:

```bash
curl -f http://localhost:3001/health
```

Expected response: `{ "status": "ok" }` (or equivalent).

> **Note:** `PORT` defaults to `3001`. If overridden via env, adjust the `lsof` command accordingly.

---

## 2. DB Migration Rollback

The project uses **Prisma**. There is no automatic `migrate down` command; rollback is a two-step process: mark the migration as rolled back, then apply a corrective migration.

**Step 1 — Identify the latest applied migration:**

```bash
cd backend
DATABASE_URL="<value>" npx prisma migrate status
```

Note the name of the last applied migration (e.g. `20240601120000_add_payment_streams`).

**Step 2 — Mark it as rolled back:**

```bash
DATABASE_URL="<value>" npx prisma migrate resolve \
  --rolled-back 20240601120000_add_payment_streams
```

**Step 3 — Apply the corrective schema change:**

Edit `prisma/schema.prisma` to revert the unwanted change, then generate and deploy a new migration:

```bash
DATABASE_URL="<value>" npx prisma migrate deploy
```

> **Warning:** `prisma migrate resolve --rolled-back` only updates Prisma's migration history table. You must also manually reverse any DDL changes (e.g. `DROP COLUMN`) in the database before deploying the corrective migration.

---

## 3. Stream Cancellation

Use the API to cancel a stream so that the event sourcing layer records the cancellation correctly. Cancelling directly in the database skips the `StreamCancelled` event published by the service layer.

**Cancel a single stream by ID:**

```bash
curl -X POST http://localhost:3001/api/v1/streaming/<stream-id>/cancel
```

**List all active streams** (to find IDs that need cancellation):

```bash
curl "http://localhost:3001/api/v1/streaming?senderPublicKey=<GXXX...>"
```

**Bulk-cancel all active streams (emergency only):**

If the API is unavailable, use the Prisma CLI to cancel directly. Be aware this bypasses event publishing.

```bash
cd backend
node --input-type=module <<'EOF'
import prisma from './src/db/client.js';
const { count } = await prisma.paymentStream.updateMany({
  where: { status: 'ACTIVE' },
  data: { status: 'CANCELLED' },
});
console.log(`Cancelled ${count} streams`);
await prisma.$disconnect();
EOF
```

---

## 4. IP Unblock

The rate-limiter whitelist is an **in-memory Set** seeded at startup from the `RATE_LIMIT_WHITELIST` environment variable. There is no persistent store — changes require an env update and a process restart.

**Step 1 — Add the IP to the whitelist in `backend/.env`:**

```bash
# Open .env and append the IP to RATE_LIMIT_WHITELIST (comma-separated)
# Example — before:
RATE_LIMIT_WHITELIST=10.0.0.1

# After:
RATE_LIMIT_WHITELIST=10.0.0.1,203.0.113.42
```

**Step 2 — Restart the backend** (see Section 1) to reload the env.

**Step 3 — Verify the IP is no longer rate-limited:**

```bash
curl -I -H "X-Forwarded-For: 203.0.113.42" http://localhost:3001/health
# Expect HTTP 200, not 429
```

> If `CONFIG_WATCH=true` is set, config file changes reload automatically without a restart — but the whitelist Set is populated at process boot only, so a restart is still required.

---

## 5. Incident Response Protocol

### 5.1 Triage

- [ ] Identify the incident type: `UNAUTHORIZED_ACCESS`, `DATA_BREACH`, `MALWARE_DETECTED`, `DDoS_ATTACK`.
- [ ] Assess severity: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`.
- [ ] Determine affected systems (e.g. `api`, `database`, `stellar-node`).

### 5.2 Open an Incident Record

```bash
curl -X POST http://localhost:3001/api/v1/security/incidents/create \
  -H "Content-Type: application/json" \
  -d '{
    "type": "UNAUTHORIZED_ACCESS",
    "severity": "CRITICAL",
    "description": "Suspicious login attempts from IP 203.0.113.99",
    "affectedSystems": ["api", "auth"]
  }'
```

Save the returned `id` (e.g. `INC-1719140400000`) for all subsequent updates.

### 5.3 Containment

- [ ] For unauthorized access: revoke active JWT sessions by rotating `JWT_SECRET` in `.env` and restarting the backend.
- [ ] For DDoS: add attacking IPs to `RATE_LIMIT_WHITELIST` **negation** — i.e. do _not_ whitelist them; lower `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS` as needed, then restart.
- [ ] For a data breach: take the backend offline, preserve logs, and do not alter any files before forensics.

### 5.4 Mark Actions Complete

```bash
# Call for each completed playbook action
curl -X POST http://localhost:3001/api/v1/security/incidents/<INC-ID>/action \
  -H "Content-Type: application/json" \
  -d '{ "action": "Block user account" }'
```

### 5.5 Post-Incident

- [ ] Review `GET /api/v1/security/audit-log` for the affected timeframe.
- [ ] Rotate any compromised secrets (see `backend/CONFIGURATION.md` — Secret rotation).
- [ ] Update `RATE_LIMIT_WHITELIST` or other env vars as needed and redeploy.
- [ ] File a post-mortem within 48 hours.

---

## 6. Database Backup Restore Procedure

The backup system is implemented in `backend/src/backup/manager.js`. Backups are compressed (`pg_dump` custom format + gzip) and optionally AES-256-GCM encrypted.

### 6.1 Prerequisites

- `BACKUP_DIR` — directory containing the backup files (default `./backups`)
- `DATABASE_URL` — connection string for the **target** database
- `BACKUP_ENC_KEY` — 32-byte hex key (required only if the backup is encrypted, i.e. file ends in `.enc`)
- PostgreSQL client tools (`pg_restore`) installed and on `$PATH`

### 6.2 List available backups

```bash
cd backend
node --input-type=module <<'EOF'
import { listBackups } from './src/backup/manager.js';
const backups = await listBackups();
backups.slice(0, 5).forEach(b => console.log(b.createdAt, b.file, `${(b.size/1e6).toFixed(1)} MB`));
EOF
```

### 6.3 Verify a backup's integrity before restoring

```bash
cd backend
BACKUP_FILE=/path/to/backup.dump.gz node --input-type=module <<'EOF'
import { verifyBackup } from './src/backup/manager.js';
const result = await verifyBackup(process.env.BACKUP_FILE);
console.log('Valid:', result.valid);
if (!result.valid) {
  console.error('Checksum mismatch — do not restore this file');
  process.exit(1);
}
EOF
```

### 6.4 Restore to the current database

```bash
cd backend
DATABASE_URL="postgresql://user:password@host:5432/dbname" \
BACKUP_ENC_KEY="<32-byte-hex-key-if-encrypted>" \
BACKUP_FILE=/path/to/backup.dump.gz \
node --input-type=module <<'EOF'
import { restoreBackup } from './src/backup/manager.js';
const result = await restoreBackup(process.env.BACKUP_FILE);
console.log('Restore status:', result.status);
EOF
```

### 6.5 Restore to a different database (safe restore drill)

Pass `targetDatabase` to restore into a fresh database without touching production:

```bash
cd backend
DATABASE_URL="postgresql://future_admin:password@localhost:5432/future_restore_drill" \
BACKUP_FILE=/path/to/backup.dump.gz \
node --input-type=module <<'EOF'
import { restoreBackup } from './src/backup/manager.js';
const result = await restoreBackup(process.env.BACKUP_FILE, {
  targetDatabase: 'future_restore_drill',
});
console.log(result);
EOF
```

### 6.6 Point-in-time recovery (PITR)

If WAL archiving is configured, pass `targetTime` (ISO 8601) to stop recovery at a specific moment:

```bash
cd backend
DATABASE_URL="postgresql://..." \
BACKUP_FILE=/path/to/backup.dump.gz \
TARGET_TIME="2025-06-01T12:00:00Z" \
node --input-type=module <<'EOF'
import { restoreBackup } from './src/backup/manager.js';
const result = await restoreBackup(process.env.BACKUP_FILE, {
  targetTime: process.env.TARGET_TIME,
});
console.log(result);
EOF
```

### 6.7 Apply pending migrations after restore

After restoring to any database, apply outstanding Prisma migrations:

```bash
cd backend
DATABASE_URL="postgresql://user:password@host:5432/dbname" npx prisma migrate deploy
```

### 6.8 Verify the restored database

Query a known table to confirm data integrity:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM \"User\";"
```

### 6.9 Automated weekly verification

The CI workflow `.github/workflows/backup-verification.yml` runs every Sunday at 03:00 UTC. It:
1. Seeds a source database, creates a backup via the backup manager
2. Verifies the backup checksum
3. Restores the backup to a fresh database instance
4. Runs `prisma migrate deploy` against the restored database
5. Queries the restored database for expected data
6. Opens a GitHub issue and notifies watchers on failure
