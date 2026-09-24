import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import pg from 'pg';
import logger from '../config/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../');

/**
 * Stable advisory lock ID used across all instances of this service.
 * Must be a 32-bit integer understood by pg_advisory_lock.
 */
export const MIGRATION_LOCK_ID = 987654321;

/**
 * How long (ms) to wait for the advisory lock before giving up.
 * Keeps the health-check probe from timing out during a slow migration.
 */
const LOCK_TIMEOUT_MS = parseInt(process.env.MIGRATION_LOCK_TIMEOUT_MS ?? '60000', 10);

/**
 * Run `prisma migrate deploy` protected by a PostgreSQL session-level
 * advisory lock so that parallel container startups (ECS desired_count > 1)
 * never race each other against the _prisma_migrations table.
 *
 * Flow:
 *  1. Open a dedicated pg.Client (not the pooled Prisma adapter – advisory
 *     locks are session-scoped and must not be released between pool hops).
 *  2. SET lock_timeout so we fail fast rather than block indefinitely.
 *  3. Acquire pg_advisory_lock — blocks until the lock is free or timeout.
 *  4. Run `prisma migrate deploy` via execSync.
 *  5. Release the lock in a finally block, which also fires on process crash
 *     because the pg session is closed and PostgreSQL auto-releases the lock.
 */
export async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    logger.warn('db.migrate.skipped', { reason: 'DATABASE_URL not set' });
    return;
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();

    // Tell PostgreSQL to abandon the lock attempt after LOCK_TIMEOUT_MS.
    // lock_timeout is a session-level GUC accepted by pg_advisory_lock.
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);

    logger.info('db.migrate.lock.acquiring', { lockId: MIGRATION_LOCK_ID });
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    logger.info('db.migrate.lock.acquired', { lockId: MIGRATION_LOCK_ID });

    try {
      logger.info('db.migrate.start');
      execSync('npx prisma migrate deploy', { cwd: root, stdio: 'pipe' });
      logger.info('db.migrate.done');
    } finally {
      // Always release — even if execSync throws.
      // PostgreSQL also auto-releases when the session ends (crash/SIGKILL).
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      logger.info('db.migrate.lock.released', { lockId: MIGRATION_LOCK_ID });
    }
  } catch (err) {
    logger.error('db.migrate.failed', { error: err.message });
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}
