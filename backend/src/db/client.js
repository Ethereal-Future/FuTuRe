import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import logger from '../config/logger.js';
import { getConfig } from '../config/env.js';

const { Pool } = pg;

// Connection pool — reused across all requests
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: getConfig().database.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('error', (e) => logger.error('db.error', { message: e.message, target: e.target }));
prisma.$on('warn',  (e) => logger.warn('db.warn',  { message: e.message, target: e.target }));

export async function connectDB() {
  const maxAttempts = 5;
  const initialDelayMs = 1000;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await prisma.$connect();
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
