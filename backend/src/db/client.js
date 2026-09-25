/**
 * PostgreSQL connection pool with bounded sizing and metrics (ISSUE-064)
 *
 * poolMax = floor(RDS_MAX_CONNECTIONS * 0.7 / MAX_ECS_TASKS), capped by CPU count.
 * In production, DATABASE_URL should point at PgBouncer (see infra/pgbouncer).
 */
import os from 'os';

const RESERVED_RATIO = 0.7;
export const POOL_WAIT_ALERT_THRESHOLD = 5;

export function computePoolMax(env = process.env) {
  const dbMax = parseInt(env.RDS_MAX_CONNECTIONS, 10) || 100;
  const tasks = parseInt(env.MAX_ECS_TASKS, 10) || 10;
  const cpuCap = Math.max(2, os.cpus().length * 4);
  const safeMax = Math.max(1, Math.min(Math.floor((dbMax * RESERVED_RATIO) / tasks), cpuCap));
  const requested = parseInt(env.DB_POOL_MAX, 10);
  if (requested > 0) {
    if (requested > safeMax) {
      console.warn(`[db] DB_POOL_MAX=${requested} exceeds safe bound ${safeMax}; clamping`);
      return safeMax;
    }
    return requested;
  }
  return safeMax;
}

/** Create a pool using an injected Pool class (e.g. from `pg`). */
export function createPool(Pool, env = process.env) {
  return new Pool({
    connectionString: env.DATABASE_URL,
    max: computePoolMax(env),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

/** Prometheus-style metrics for a pg Pool. */
export function getPoolMetrics(pool) {
  const total = pool.totalCount ?? 0;
  const idle = pool.idleCount ?? 0;
  const waiting = pool.waitingCount ?? 0;
  return {
    pg_pool_active_connections: total - idle,
    pg_pool_idle_connections: idle,
    pg_pool_waiting_queries: waiting,
    alert: waiting > POOL_WAIT_ALERT_THRESHOLD,
  };
}

export function formatPoolMetrics(pool) {
  const { alert, ...m } = getPoolMetrics(pool);
  return Object.entries(m).map(([k, v]) => `${k} ${v}`).join('\n') + '\n';
}
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import logger from '../config/logger.js';
import { getConfig } from '../config/env.js';
import { createSoftDeleteExtension } from './softDelete.js';
import { getRequestSignal, RequestAbortedError, throwIfAborted } from './requestContext.js';

const { Pool } = pg;

// Configurable query timeout in milliseconds (default: 5 000 ms)
const QUERY_TIMEOUT_MS = parseInt(process.env.DB_QUERY_TIMEOUT_MS ?? '5000', 10);
const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || 'development').trim().toLowerCase();
const isDev = appEnv === 'development';

// Support PgBouncer via a dedicated pool URL (transaction pooling mode).
const poolConnectionString = process.env.DATABASE_POOL_URL || process.env.DATABASE_URL;

function appendStatementTimeoutOption(existing) {
  const option = `-c statement_timeout=${QUERY_TIMEOUT_MS}`;
  if (!existing) return option;
  if (/statement_timeout\s*=/.test(existing)) return existing;
  return `${existing} ${option}`;
}

// statement_timeout is sent in the startup packet (`options` parameter) so it
// applies to every physical connection, including those handed out by PgBouncer
// in transaction pooling mode where session-level `SET` does not persist.
function buildConnectionString(url, { pgBouncer = false } = {}) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (pgBouncer && !parsed.searchParams.has('pgbouncer')) {
      parsed.searchParams.set('pgbouncer', 'true');
    }
    parsed.searchParams.set(
      'options',
      appendStatementTimeoutOption(parsed.searchParams.get('options'))
    );
    return parsed.toString();
  } catch {
    return url;
  }
}

const usePgBouncer = Boolean(process.env.DATABASE_POOL_URL);
const adapterConnectionString = buildConnectionString(poolConnectionString, {
  pgBouncer: usePgBouncer,
});

// Connection pool — reused across all requests
const pool = new Pool({
  connectionString: adapterConnectionString,
  max: parseInt(process.env.DB_POOL_MAX, 10) || getConfig().database.poolMax || 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Optional read-replica pool (e.g. RDS reader endpoint). Falls back to primary.
const readUrl = process.env.DATABASE_READ_URL;
const hasReplica = Boolean(readUrl) && readUrl !== process.env.DATABASE_URL;
const readPool = hasReplica
  ? new Pool({ connectionString: readUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 })
  : null;

const READ_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy']);

// Latency metrics: primary vs replica
export const dbMetrics = {
  primary: { count: 0, totalMs: 0 },
  replica: { count: 0, totalMs: 0 },
};

function createClient(p, target) {
  const client = new PrismaClient({
    adapter: new PrismaPg(p),
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });
  client.$on('error', (e) => logger.error('db.error', { target, message: e.message }));
  client.$on('warn',  (e) => logger.warn('db.warn',  { target, message: e.message }));
  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        const start = performance.now();
        try {
          return await query(args);
        } finally {
          const m = dbMetrics[target];
          m.count += 1;
          m.totalMs += performance.now() - start;
        }
      },
    },
  });
}

const prismaWrite = createClient(pool, 'primary');
const prismaRead = readPool ? createClient(readPool, 'replica') : prismaWrite;

// Primary client that transparently routes read-only model queries to the replica.
// Writes and interactive $transaction always hit the primary. Use `withPrimary()`
// (or prismaWrite directly) for read-your-own-writes flows.
let forcePrimaryDepth = 0;
const prisma = readPool
  ? prismaWrite.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (forcePrimaryDepth === 0 && READ_OPS.has(operation)) {
              const delegate = prismaRead[model.charAt(0).toLowerCase() + model.slice(1)];
              return delegate[operation](args);
            }
            return query(args);
          },
        },
      },
    })
  : prismaWrite;

/** Run fn with all queries pinned to the primary (read-your-own-writes). */
export async function withPrimary(fn) {
  forcePrimaryDepth += 1;
  try {
    return await fn(prismaWrite);
  } finally {
    forcePrimaryDepth -= 1;
  }
}

export function getDBMetrics() {
  const avg = ({ count, totalMs }) => ({ count, avgMs: count ? totalMs / count : 0 });
  return { replicaEnabled: Boolean(readPool), primary: avg(dbMetrics.primary), replica: avg(dbMetrics.replica) };
}

export { prismaRead, prismaWrite };

export async function connectDB() {
  await prismaWrite.$connect();
  if (readPool) await prismaRead.$connect();
  logger.info('db.connected', { replica: Boolean(readPool) });
}

export async function disconnectDB() {
  await prismaWrite.$disconnect();
  if (readPool) {
    await prismaRead.$disconnect();
    await readPool.end();
  }
// Layer 1 — PostgreSQL server-side timeout.
// Primary enforcement is the startup `options` parameter set in
// buildConnectionString. The session-level SET below is only a fallback for
// direct connections: under PgBouncer transaction pooling a session SET is
// either reset (DISCARD ALL) or leaks into other clients' transactions.
if (!usePgBouncer) {
  pool.on('connect', (client) => {
    client
      .query(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`)
      .catch((err) => logger.error('db.statement_timeout.set.failed', { error: err.message }));
  });
}

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

/**
 * Races `promise` against a timeout and the request abort signal. The timer and
 * abort listener are always released once the race settles, and a late
 * rejection from the losing query promise is swallowed so it cannot surface as
 * an unhandled rejection.
 */
function raceWithTimeout(promise, { timeoutMs = QUERY_TIMEOUT_MS, signal } = {}) {
  let timer;
  let onAbort;

  promise.catch(() => {});

  const guards = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`DB query timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
    if (signal) {
      onAbort = () => reject(new RequestAbortedError());
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  return Promise.race([promise, guards]).finally(() => {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  });
}

// Layer 2 — soft-delete filter + Node.js-side timeout + request abort via
// Prisma client extensions.
const prisma = baseClient.$extends(createSoftDeleteExtension()).$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const signal = getRequestSignal();
        throwIfAborted(signal);
        return raceWithTimeout(query(args), { signal });
      },
    },
  },
});

baseClient.$on('error', (e) => logger.error('db.error', { message: e.message, target: e.target }));
baseClient.$on('warn', (e) => logger.warn('db.warn', { message: e.message, target: e.target }));

if (queryLogEnabled) {
  baseClient.$on('query', (e) => {
    logger.debug('db.query', {
      query: e.query,
      params: e.params,
      duration_ms: e.duration,
    });
  });
}

export class DatabaseConnectionError extends Error {
  constructor(message, { attempts, cause } = {}) {
    super(message, { cause });
    this.name = 'DatabaseConnectionError';
    this.attempts = attempts;
  }
}

const CONNECT_MAX_ATTEMPTS = parseInt(process.env.DB_CONNECT_MAX_ATTEMPTS ?? '10', 10);
const CONNECT_INITIAL_DELAY_MS = parseInt(process.env.DB_CONNECT_INITIAL_DELAY_MS ?? '1000', 10);
const CONNECT_MAX_DELAY_MS = parseInt(process.env.DB_CONNECT_MAX_DELAY_MS ?? '10000', 10);

// 'disconnected' | 'connecting' | 'connected' | 'failed'
let connectionState = 'disconnected';
let lastConnectionError = null;
let reconnectLoop = null;
let stopReconnect = false;

export function getDBConnectionState() {
  return { state: connectionState, error: lastConnectionError };
}

/**
 * Connects to PostgreSQL with capped exponential backoff
 * (1s, 2s, 4s, 8s, then 10s per attempt by default — ~65s over 10 attempts).
 * Throws DatabaseConnectionError on exhaustion; lifecycle decisions (exit vs.
 * degraded mode) belong to the caller.
 */
export async function connectDB({
  maxAttempts = CONNECT_MAX_ATTEMPTS,
  initialDelayMs = CONNECT_INITIAL_DELAY_MS,
  maxDelayMs = CONNECT_MAX_DELAY_MS,
} = {}) {
  connectionState = 'connecting';
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await baseClient.$connect();
      connectionState = 'connected';
      lastConnectionError = null;
      logger.info('db.connected', { attempt });
      return;
    } catch (err) {
      lastErr = err;
      lastConnectionError = err.message;
      if (attempt === maxAttempts || stopReconnect) break;

      const delayMs = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      logger.warn('db.connection.retry', {
        attempt,
        maxAttempts,
        delayMs,
        error: err.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  connectionState = 'failed';
  logger.error('db.connection.failed', {
    message: lastErr?.message,
    attempts: maxAttempts,
  });
  throw new DatabaseConnectionError(
    'Failed to connect to database after ' + maxAttempts + ' attempts',
    { attempts: maxAttempts, cause: lastErr }
  );
}

/**
 * Keeps retrying connectDB in the background until it succeeds or
 * disconnectDB is called. Used by the server to run in degraded mode while
 * the database recovers (e.g. RDS failover).
 */
export function reconnectDBInBackground({ pauseMs = CONNECT_MAX_DELAY_MS } = {}) {
  if (reconnectLoop) return reconnectLoop;
  stopReconnect = false;

  reconnectLoop = (async () => {
    while (!stopReconnect && connectionState !== 'connected') {
      try {
        await connectDB();
      } catch (err) {
        if (!(err instanceof DatabaseConnectionError)) throw err;
        if (stopReconnect) break;
        await new Promise((resolve) => setTimeout(resolve, pauseMs).unref?.());
      }
    }
  })()
    .catch((err) => logger.error('db.reconnect.error', { error: err.message }))
    .finally(() => {
      reconnectLoop = null;
    });

  return reconnectLoop;
}

/**
 * Runs a raw SQL statement on a dedicated pool connection that is cancelled
 * server-side (pg_cancel_backend) if `signal` aborts mid-execution, releasing
 * any locks held by the statement.
 */
export async function abortableQuery(text, params = [], { signal = getRequestSignal() } = {}) {
  throwIfAborted(signal);
  const client = await pool.connect();
  let onAbort;
  try {
    throwIfAborted(signal);
    const {
      rows: [{ pid }],
    } = await client.query('SELECT pg_backend_pid() AS pid');

    if (signal) {
      onAbort = () => {
        pool
          .query('SELECT pg_cancel_backend($1)', [pid])
          .then(() => logger.warn('db.query.cancelled', { pid }))
          .catch((err) => logger.error('db.query.cancel.failed', { pid, error: err.message }));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      return await raceWithTimeout(client.query(text, params), { signal });
    } catch (err) {
      // 57014 = query_canceled (raised by pg_cancel_backend)
      if (signal?.aborted || err.code === '57014') throw new RequestAbortedError();
      throw err;
    }
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    client.release();
  }
}

/**
 * Interactive transaction bound to the request abort signal. The signal is
 * checked before the transaction starts, before every model operation (via the
 * query extension) and immediately before commit; throwing inside the callback
 * makes Prisma roll the transaction back, so no locks outlive a disconnected
 * client.
 */
export async function abortableTransaction(fn, { signal = getRequestSignal(), ...options } = {}) {
  throwIfAborted(signal);
  return prisma.$transaction(async (tx) => {
    const checkpoint = () => throwIfAborted(signal);
    checkpoint();
    const result = await fn(tx, checkpoint);
    checkpoint();
    return result;
  }, options);
}

export async function disconnectDB() {
  stopReconnect = true;
  await baseClient.$disconnect();
  connectionState = 'disconnected';
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

export { QUERY_TIMEOUT_MS, RequestAbortedError, buildConnectionString, raceWithTimeout };
export default prisma;
