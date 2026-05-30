import { createRedisBackend } from '../cache/redis.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';
import { sendEmail } from '../notifications/email.js';

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const FAILED_ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

let redisBackend = null;

async function initRedis() {
  if (!redisBackend) {
    const redisUrl = process.env.REDIS_URL;
    redisBackend = createRedisBackend(redisUrl);
    if (redisBackend.client) {
      await redisBackend.connect();
    }
  }
  return redisBackend;
}

export async function recordFailedLogin(username, ipAddress) {
  const redis = await initRedis();
  const key = `failed_login:${username}`;
  const lockoutKey = `account_locked:${username}`;
  
  // Check if account is already locked
  const isLocked = await redis.get(lockoutKey);
  if (isLocked) {
    return { locked: true, reason: 'Account is temporarily locked' };
  }

  // Get current failed attempts
  const attempts = (await redis.get(key)) || [];
  const now = Date.now();
  
  // Filter out old attempts outside the window
  const recentAttempts = attempts.filter(t => now - t < FAILED_ATTEMPT_WINDOW_MS);
  recentAttempts.push(now);

  // Store updated attempts
  await redis.set(key, recentAttempts, Math.ceil(FAILED_ATTEMPT_WINDOW_MS / 1000));

  if (recentAttempts.length >= LOCKOUT_THRESHOLD) {
    // Lock the account
    await redis.set(lockoutKey, { lockedAt: now, ipAddress }, Math.ceil(LOCKOUT_DURATION_MS / 1000));
    
    // Log the lockout
    logger.warn({
      username,
      ipAddress,
      attempts: recentAttempts.length,
    }, 'Account locked due to excessive failed login attempts');

    // Send email notification
    try {
      const user = await prisma.user.findUnique({ where: { username } });
      if (user?.email) {
        await sendEmail({
          to: user.email,
          subject: 'Security Alert: Your account has been locked',
          template: 'account_locked',
          data: {
            username,
            ipAddress,
            unlockTime: new Date(now + LOCKOUT_DURATION_MS).toISOString(),
          },
        });
      }
    } catch (err) {
      logger.error({ err, username }, 'Failed to send account lockout email');
    }

    return { locked: true, reason: 'Account locked due to too many failed attempts' };
  }

  return { locked: false, attempts: recentAttempts.length };
}

export async function isAccountLocked(username) {
  const redis = await initRedis();
  const lockoutKey = `account_locked:${username}`;
  const lockoutData = await redis.get(lockoutKey);
  return !!lockoutData;
}

export async function unlockAccount(username) {
  const redis = await initRedis();
  const lockoutKey = `account_locked:${username}`;
  const failedKey = `failed_login:${username}`;
  
  await redis.delete(lockoutKey);
  await redis.delete(failedKey);
  
  logger.info({ username }, 'Account manually unlocked');
}

export async function clearFailedAttempts(username) {
  const redis = await initRedis();
  const failedKey = `failed_login:${username}`;
  await redis.delete(failedKey);
}

export function getLockoutDuration() {
  return LOCKOUT_DURATION_MS;
}
