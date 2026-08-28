import crypto from 'crypto';
import { redisGet, redisSet, redisDelete, redisSetAdd, redisSetRemove, redisSetMembers } from './redisStore.js';

// Sessions live in Redis (`mobile:session:{sessionId}`) with a 30-day TTL,
// plus a secondary per-user index set (`mobile:user_sessions:{userId}`) so
// listForUser/revokeAll don't require a Redis SCAN (issue #1124). This
// replaces the previous in-process Map, which only worked correctly for a
// single server instance.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);

function sessionKey(sessionId) {
  return `mobile:session:${sessionId}`;
}

function userSessionsKey(userId) {
  return `mobile:user_sessions:${userId}`;
}

class MobileSessions {
  async create(userId, deviceId, metadata = {}) {
    const sessionId = crypto.randomUUID();
    const session = {
      sessionId,
      userId,
      deviceId,
      metadata,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    await redisSet(sessionKey(sessionId), session, SESSION_TTL_SECONDS);
    await redisSetAdd(userSessionsKey(userId), sessionId);
    return sessionId;
  }

  async get(sessionId) {
    const session = await redisGet(sessionKey(sessionId));
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      await this.revoke(sessionId, session.userId);
      return null;
    }
    session.lastActiveAt = Date.now();
    // Persist the refreshed lastActiveAt using the session's *remaining*
    // TTL, so reading a session doesn't reset its 30-day expiry window.
    const remainingSeconds = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
    await redisSet(sessionKey(sessionId), session, remainingSeconds);
    return session;
  }

  /**
   * Revoke a single session.
   * @param {string} sessionId
   * @param {string} [userId] - Pass when already known, to avoid an extra Redis read to find it for index cleanup.
   */
  async revoke(sessionId, userId) {
    let uid = userId;
    if (!uid) {
      const session = await redisGet(sessionKey(sessionId));
      uid = session?.userId;
    }
    await redisDelete(sessionKey(sessionId));
    if (uid) await redisSetRemove(userSessionsKey(uid), sessionId);
    return true;
  }

  async revokeAll(userId) {
    const sessionIds = await redisSetMembers(userSessionsKey(userId));
    let count = 0;
    for (const sessionId of sessionIds) {
      await redisDelete(sessionKey(sessionId));
      await redisSetRemove(userSessionsKey(userId), sessionId);
      count++;
    }
    return count;
  }

  async listForUser(userId) {
    const sessionIds = await redisSetMembers(userSessionsKey(userId));
    const sessions = [];
    for (const sessionId of sessionIds) {
      const session = await redisGet(sessionKey(sessionId));
      if (session && Date.now() <= session.expiresAt) {
        sessions.push(session);
      } else {
        // Session already expired (or TTL'd out of Redis) — drop the stale
        // index entry so future listForUser/revokeAll calls stay accurate.
        await redisSetRemove(userSessionsKey(userId), sessionId);
      }
    }
    return sessions;
  }
}

export default new MobileSessions();
