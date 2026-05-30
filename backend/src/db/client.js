import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import logger from '../config/logger.js';
import { getConfig } from '../config/env.js';
import { setupSoftDeleteMiddleware } from './softDelete.js';

const { Pool } = pg;

// Configurable query timeout in milliseconds (default: 5 000 ms)
const QUERY_TIMEOUT_MS = parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? '5000', 10);
const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || 'development').trim().toLowerCase();
const isDev = appEnv === 'development';

// Support PgBouncer via a dedicated pool URL (transaction pooling mode).
const poolConnectionString = process.env.DATABASE_POOL_URL || process.env.DATABASE_URL;

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
  max: parseInt(process.env.DB_POOL_MAX, 10) || getConfig().database.poolMax || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Layer 1 — PostgreSQL server-side timeout.
pool.on('connect', (client) => {
  client.query(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`).catch((err) =>
    logger.error('db.statement_timeout.set.failed', { error: err.message })
  );
});

const adapter = new PrismaPg(pool);

// Enable query-level logging in development or when PRISMA_QUERY_LOG=true.
const queryLogEnabled = isDev || process.env.PRISMA_QUERY_LOG === 'true';

const prismaLogConfig = [
  { emit: 'event', level: 'error' },
  { emit: 'event', level: 'warn' },
  ...(queryLogEnabled ? [{ emit: 'event', level: 'query' }] : []),
];

const baseClient = new PrismaClient({
  adapter,
  log: prismaLogConfig,
});

// Layer 2 — Node.js-side timeout via Prisma client extension.
const prisma = baseClient.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const timeout = new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`DB query timed out after ${QUERY_TIMEOUT_MS}ms`)),
            QUERY_TIMEOUT_MS
          )
        );
        return Promise.race([query(args), timeout]);
      },
    },
  },
});

baseClient.$on('error', (e) => logger.error('db.error', { message: e.message, target: e.target }));
baseClient.$on('warn',  (e) => logger.warn('db.warn',  { message: e.message, target: e.target }));

if (queryLogEnabled) {
  baseClient.$on('query', (e) => {
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
  const maxAttempts = 5;
  const initialDelayMs = 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await baseClient.$connect();
      logger.info('db.connected');
      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        logger.error('db.connection.failed', {
          message: err.message,
          attempts: maxAttempts,
        });
        process.exit(1);
      }

      const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
      logger.warn('db.connection.retry', {
        attempt,
        maxAttempts,
        delayMs,
        error: err.message,
      });

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

export async function disconnectDB() {
  await baseClient.$disconnect();
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

export { QUERY_TIMEOUT_MS };
export default prisma;
