import { createRedisBackend } from '../cache/redis.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';
import { sendEmail } from '../notifications/email.js';

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const FAILED_ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const IP_BLOCK_DURATION_MS = 60 * 60 * 1000; // 1 hour

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
  
  // Check if IP is blocked
  const ipBlocked = await isIPBlocked(ipAddress);
  if (ipBlocked) {
    return { locked: true, reason: 'IP address is temporarily blocked', ipBlocked: true };
  }
  
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
    
    // Also block the IP address
    await blockIP(ipAddress, `Excessive failed login attempts for ${username}`);
    
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

// ── Unified Brute-Force Protection (IP-based) ──────────────────────────────────

export async function isIPBlocked(ipAddress) {
  const redis = await initRedis();
  const key = `blocked_ip:${ipAddress}`;
  const blocked = await redis.get(key);
  return !!blocked;
}

export async function blockIP(ipAddress, reason = 'Excessive failed login attempts') {
  const redis = await initRedis();
  const key = `blocked_ip:${ipAddress}`;
  const patternKey = `suspicious_patterns`;
  
  await redis.set(key, { blockedAt: Date.now(), reason }, Math.ceil(IP_BLOCK_DURATION_MS / 1000));
  
  // Store suspicious pattern
  const pattern = {
    type: 'IP_BLOCKED',
    ipAddress,
    reason,
    timestamp: new Date().toISOString(),
  };
  
  const patterns = (await redis.get(patternKey)) || [];
  patterns.push(pattern);
  
  // Keep last 1000 patterns
  if (patterns.length > 1000) {
    patterns.shift();
  }
  
  await redis.set(patternKey, patterns, 24 * 60 * 60); // 24 hours TTL
  
  logger.warn({ ipAddress, reason }, 'IP address blocked');
}

export async function unblockIP(ipAddress) {
  const redis = await initRedis();
  const key = `blocked_ip:${ipAddress}`;
  await redis.delete(key);
  logger.info({ ipAddress }, 'IP address manually unblocked');
}

export async function getSuspiciousPatterns(limit = 100) {
  const redis = await initRedis();
  const patternKey = `suspicious_patterns`;
  const patterns = (await redis.get(patternKey)) || [];
  return patterns.slice(-limit);
}

export async function clearOldPatterns(olderThanHours = 24) {
  const redis = await initRedis();
  const patternKey = `suspicious_patterns`;
  const patterns = (await redis.get(patternKey)) || [];
  const cutoff = Date.now() - olderThanHours * 60 * 60 * 1000;
  
  const filtered = patterns.filter(p => new Date(p.timestamp).getTime() > cutoff);
  await redis.set(patternKey, filtered, 24 * 60 * 60);
  
  return patterns.length - filtered.length;
}

// ── Threat Detection ─────────────────────────────────────────────────────────

export function detectAnomalousActivity(userId, activity) {
  const threats = [];

  // Detect rapid location changes
  if (activity.previousLocation && activity.currentLocation) {
    if (activity.previousLocation !== activity.currentLocation) {
      threats.push({
        type: 'LOCATION_CHANGE',
        severity: 'MEDIUM',
        message: 'Unusual location change detected',
      });
    }
  }

  // Detect unusual access times
  const hour = new Date().getHours();
  if (hour < 6 || hour > 22) {
    threats.push({
      type: 'UNUSUAL_TIME',
      severity: 'LOW',
      message: 'Access outside normal hours',
    });
  }

  // Detect large transactions
  if (activity.amount && activity.amount > 10000) {
    threats.push({
      type: 'LARGE_TRANSACTION',
      severity: 'MEDIUM',
      message: 'Unusually large transaction detected',
    });
  }

  return threats;
}
