import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import logger from '../config/logger.js';
import { setupSoftDeleteMiddleware } from './softDelete.js';

const { Pool } = pg;

const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || 'development').trim().toLowerCase();
const isDev = appEnv === 'development';

// Support PgBouncer via a dedicated pool URL (transaction pooling mode).
// When DATABASE_POOL_URL is set, the pooler connection is used for the Prisma
// adapter; DATABASE_URL is still used for direct migrations / health checks.
const poolConnectionString = process.env.DATABASE_POOL_URL || process.env.DATABASE_URL;

// Append ?pgbouncer=true when the connection string targets a PgBouncer
// endpoint so Prisma disables prepared statements (required for transaction
// pooling mode).
function buildConnectionString(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('pgbouncer')) {
      parsed.searchParams.set('pgbouncer', 'true');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

const usePgBouncer = Boolean(process.env.DATABASE_POOL_URL);
const adapterConnectionString = usePgBouncer
  ? buildConnectionString(poolConnectionString)
  : poolConnectionString;

// Connection pool — reused across all requests
const pool = new Pool({
  connectionString: adapterConnectionString,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const adapter = new PrismaPg(pool);

// Enable query-level logging in development or when PRISMA_QUERY_LOG=true.
const queryLogEnabled = isDev || process.env.PRISMA_QUERY_LOG === 'true';

const prismaLogConfig = [
  { emit: 'event', level: 'error' },
  { emit: 'event', level: 'warn' },
  ...(queryLogEnabled ? [{ emit: 'event', level: 'query' }] : []),
];

const prisma = new PrismaClient({
  adapter,
  log: prismaLogConfig,
});

prisma.$on('error', (e) => logger.error('db.error', { message: e.message, target: e.target }));
prisma.$on('warn',  (e) => logger.warn('db.warn',  { message: e.message, target: e.target }));

if (queryLogEnabled) {
  prisma.$on('query', (e) => {
    logger.debug('db.query', {
      query: e.query,
      params: e.params,
      duration_ms: e.duration,
    });
  });
}
// Setup soft delete middleware
setupSoftDeleteMiddleware(prisma);

export async function connectDB() {
  await prisma.$connect();
  logger.info('db.connected');
}

export async function disconnectDB() {
  await prisma.$disconnect();
  await pool.end();
  logger.info('db.disconnected');
}

export async function checkDBHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok' };
  } catch (err) {
    logger.error('db.healthCheck.failed', { error: err.message });
    return { status: 'error', error: err.message };
  }
}

export default prisma;
