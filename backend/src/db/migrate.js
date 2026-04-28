import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import logger from '../config/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../');

export async function runMigrations() {
  if (!process.env.DATABASE_URL) {
    logger.warn('db.migrate.skipped', { reason: 'DATABASE_URL not set' });
    return;
  }
  try {
    logger.info('db.migrate.start');
    execSync('npx prisma migrate deploy', { cwd: root, stdio: 'pipe' });
    logger.info('db.migrate.done');
  } catch (err) {
    logger.error('db.migrate.failed', { error: err.stderr?.toString() || err.message });
    throw err;
  }
}
