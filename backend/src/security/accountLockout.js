import { createRedisBackend } from '../cache/redis.js';
import prisma from '../db/client.js';
import logger from '../config/logger.js';
import { sendEmail } from '../notifications/channels/email.js';

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

// ── Atomic failed-attempt counter via Lua ────────────────────────────────────
//
// Problem (ISSUE-150 / #1397):
//   The previous implementation used a read-modify-write sequence:
//     1. GET key           (read array)
//     2. filter + push     (local mutation)
//     3. SET key newArray  (write back)
//   Between steps 1 and 3 a concurrent request could read the same stale
//   array, meaning two simultaneous failures both saw count N and wrote N+1
//   instead of N+2.  An attacker could exploit this to stay permanently
//   below the lockout threshold across distributed login bursts.
//
// Fix:
//   Replace the array with a simple integer counter and use a Lua script that
//   executes INCR + conditional EXPIRE atomically on the Redis server.
//   Because Lua scripts run single-threaded inside Redis, no two callers can
//   interleave between the INCR and the EXPIRE — the counter is always exact.
//
//   Script contract:
//     KEYS[1]  = failed_login:<username>  counter key
//     ARGV[1]  = window TTL in seconds
//     Returns  = new counter value (integer)
//
const ATOMIC_INCR_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

/**
 * Atomically increment the failed-login counter for `username` and return
 * the new total within the current window.
 *
 * Falls back gracefully to a non-atomic in-memory path when Redis is not
 * configured (dev/test environments), preserving existing behaviour.
 *
 * @param {object} redis  RedisBackend instance
 * @param {string} key    Redis key for the counter
 * @returns {Promise<number>}  New attempt count
 */
async function atomicIncrFailedAttempt(redis, key) {
  const windowTtlSeconds = Math.ceil(FAILED_ATTEMPT_WINDOW_MS / 1000);

  if (redis.client) {
    // Atomic path: Lua script guarantees INCR + EXPIRE are one unit of work
    const result = await redis.client.eval(
      ATOMIC_INCR_LUA,
      1,           // number of keys
      key,         // KEYS[1]
      String(windowTtlSeconds), // ARGV[1]
    );
    return Number(result);
  }

  // No-Redis fallback (dev / test): simple in-memory counter
  // Not safe under concurrency but acceptable outside production
  const current = (await redis.get(key)) || 0;
  const next = current + 1;
  await redis.set(key, next, windowTtlSeconds);
  return next;
}

// ── Public API ───────────────────────────────────────────────────────────────

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

  // Atomically increment the counter — no read-modify-write race possible
  const attemptCount = await atomicIncrFailedAttempt(redis, key);

  if (attemptCount >= LOCKOUT_THRESHOLD) {
    const now = Date.now();

    // Lock the account
    await redis.set(
      lockoutKey,
      { lockedAt: now, ipAddress },
      Math.ceil(LOCKOUT_DURATION_MS / 1000),
    );

    // Also block the originating IP
    await blockIP(ipAddress, `Excessive failed login attempts for ${username}`);

    logger.warn(
      { username, ipAddress, attempts: attemptCount },
      'Account locked due to excessive failed login attempts',
    );

    // Send email notification to the account holder
    try {
      const user = await prisma.user.findUnique({ where: { username } });
      if (user?.email) {
        await sendEmail({
          to: user.email,
          subject: 'Security Alert: Your account has been locked',
          text:
            `Hi ${username},\n\n` +
            `Your account has been temporarily locked after ${attemptCount} failed ` +
            `login attempts from IP ${ipAddress}.\n\n` +
            `It will unlock at ${new Date(now + LOCKOUT_DURATION_MS).toISOString()}.\n\n` +
            `If this was not you, please contact support immediately.`,
        });
      }
    } catch (err) {
      logger.error({ err, username }, 'Failed to send account lockout email');
    }

    return { locked: true, reason: 'Account locked due to too many failed attempts' };
  }

  return { locked: false, attempts: attemptCount };
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

// ── Unified Brute-Force Protection (IP-based) ─────────────────────────────────

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

// ── Threat Detection ──────────────────────────────────────────────────────────

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
