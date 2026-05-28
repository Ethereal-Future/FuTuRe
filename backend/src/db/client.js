import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from '@prisma/client';
const { PrismaClient } = pkg;
import logger from '../config/logger.js';

const { Pool } = pg;

// Connection pool — reused across all requests
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
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
