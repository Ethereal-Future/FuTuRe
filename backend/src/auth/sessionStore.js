/**
 * Unified session store for web and mobile clients (issue #1381).
 *
 * Every session — browser or mobile app — is a row in the Prisma `Session`
 * table. Mobile sessions additionally carry the device binding metadata
 * (`deviceId`, `deviceModel`, `osVersion`, `appVersion`); web sessions leave
 * those columns null. Because both platforms share one table, a global
 * logout is a single transactional UPDATE instead of two independent
 * revocations that could drift apart.
 *
 * Reads go through a Redis read-through cache, and lastActiveAt writes are
 * throttled to avoid an UPDATE on every authenticated request (MVCC bloat /
 * write amplification).
 */
import prisma from '../db/client.js';
import { RedisBackend } from '../cache/redis.js';
import logger from '../config/logger.js';

export const LAST_ACTIVE_THROTTLE_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const redis = new RedisBackend(process.env.REDIS_URL || null);
const connected = redis.connect();
const key = (id) => `session:${id}`;

export class SessionDeviceMismatchError extends Error {
  constructor(message = 'Session is not bound to this device') {
    super(message);
    this.name = 'SessionDeviceMismatchError';
    this.code = 'SESSION_DEVICE_MISMATCH';
    this.status = 401;
  }
}

function parseDevice(userAgent) {
  if (!userAgent) return 'Unknown device';
  if (/iPhone|iPad/i.test(userAgent)) return 'iPhone / iPad';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Macintosh|Mac OS/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Web browser';
}

async function cacheSession(session) {
  const ttlSec = Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000);
  if (ttlSec > 0) await redis.set(key(session.id), session, ttlSec);
}

async function invalidate(ids) {
  await connected;
  await Promise.all(ids.map((id) => redis.delete(key(id))));
}

/**
 * Create a session. Pass `deviceId` (and optionally the other device fields)
 * to create a device-bound mobile session.
 */
export async function createSession(
  userId,
  {
    ipAddress,
    userAgent,
    deviceId,
    deviceModel,
    osVersion,
    appVersion,
    ttlMs = SESSION_TTL_MS,
  } = {},
) {
  const session = await prisma.session.create({
    data: {
      userId,
      device: deviceModel ?? parseDevice(userAgent),
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      deviceId: deviceId ?? null,
      deviceModel: deviceModel ?? null,
      osVersion: osVersion ?? null,
      appVersion: appVersion ?? null,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  await connected;
  await cacheSession(session);
  return session;
}

export async function getActiveSession(sessionId) {
  if (!sessionId) return null;
  await connected;

  let session = await redis.get(key(sessionId));
  if (!session) {
    session = await prisma.session.findFirst({
      where: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!session) return null;
    await cacheSession(session);
  } else if (session.revokedAt || new Date(session.expiresAt) <= new Date()) {
    return null;
  }

  // Throttled, non-blocking activity update
  const last = session.lastActiveAt ? new Date(session.lastActiveAt).getTime() : 0;
  if (Date.now() - last > LAST_ACTIVE_THROTTLE_MS) {
    const lastActiveAt = new Date();
    session = { ...session, lastActiveAt };
    cacheSession(session).catch(() => {});
    prisma.session
      .update({ where: { id: sessionId }, data: { lastActiveAt } })
      .catch((err) => logger.warn('session.lastActiveAt.updateFailed', { sessionId, error: err.message }));
  }
  return session;
}

/**
 * Resolve an active session and enforce its device binding. A session that
 * was issued to a device (mobile) must be presented with the same
 * `X-Device-Id`. Web sessions (no stored deviceId) carry no device binding.
 *
 * @returns {Promise<object|null>} The session, or null when missing/revoked/expired.
 * @throws {SessionDeviceMismatchError} When the device binding doesn't match.
 */
export async function getActiveSessionForDevice(sessionId, deviceId) {
  const session = await getActiveSession(sessionId);
  if (!session) return null;
  if (session.deviceId && session.deviceId !== deviceId) {
    throw new SessionDeviceMismatchError();
  }
  return session;
}

export async function listUserSessions(userId, currentSessionId) {
  const sessions = await prisma.session.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastActiveAt: 'desc' },
    select: {
      id: true,
      device: true,
      deviceId: true,
      deviceModel: true,
      osVersion: true,
      appVersion: true,
      ipAddress: true,
      lastActiveAt: true,
      createdAt: true,
    },
  });
  return sessions.map((s) => ({
    ...s,
    platform: s.deviceId ? 'mobile' : 'web',
    current: s.id === currentSessionId,
  }));
}

export async function revokeSession(sessionId, userId) {
  const where = { id: sessionId, revokedAt: null };
  if (userId) where.userId = userId;
  const result = await prisma.session.updateMany({
    where,
    data: { revokedAt: new Date() },
  });
  await invalidate([sessionId]);
  return result.count > 0;
}

/**
 * Global logout: revoke every active session for `userId` — web *and*
 * mobile — in a single database transaction, then drop the revoked ids from
 * the Redis read-through cache so no instance keeps serving them.
 *
 * @param {string} userId
 * @param {string|null} [exceptSessionId] - Keep this session (e.g. "log out other devices").
 * @returns {Promise<number>} Number of sessions revoked.
 */
export async function revokeAllSessions(userId, exceptSessionId = null) {
  const where = { userId, revokedAt: null };
  if (exceptSessionId) {
    where.id = { not: exceptSessionId };
  }

  const revokedIds = await prisma.$transaction(async (tx) => {
    const active = await tx.session.findMany({ where, select: { id: true } });
    if (active.length === 0) return [];
    const ids = active.map((s) => s.id);
    await tx.session.updateMany({
      where: { id: { in: ids }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return ids;
  });

  await invalidate(revokedIds);
  return revokedIds.length;
}
