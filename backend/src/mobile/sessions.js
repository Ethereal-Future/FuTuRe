/**
 * Mobile sessions, persisted in the unified Prisma `Session` table alongside
 * web sessions (issue #1381). This replaces the previous Redis-only store
 * (issue #1124), which a web "log out everywhere" could not see — mobile
 * tokens kept working after a global logout.
 *
 * Every mobile session is bound to the `deviceId` it was issued to;
 * `validate()` rejects any request whose `X-Device-Id` doesn't match.
 */
import {
  createSession,
  getActiveSession,
  getActiveSessionForDevice,
  listUserSessions,
  revokeSession,
  revokeAllSessions,
  SessionDeviceMismatchError,
} from '../auth/sessionStore.js';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function toMobileSession(session) {
  return {
    sessionId: session.id,
    userId: session.userId,
    deviceId: session.deviceId,
    metadata: {
      deviceModel: session.deviceModel ?? null,
      osVersion: session.osVersion ?? null,
      appVersion: session.appVersion ?? null,
    },
    createdAt: new Date(session.createdAt).getTime(),
    lastActiveAt: new Date(session.lastActiveAt).getTime(),
    expiresAt: new Date(session.expiresAt).getTime(),
  };
}

class MobileSessions {
  /**
   * @param {string} userId
   * @param {string} deviceId - Required: the device this session is bound to.
   * @param {{ deviceModel?: string, osVersion?: string, appVersion?: string,
   *           userAgent?: string, ipAddress?: string, ttlMs?: number }} [metadata]
   * @returns {Promise<string>} The new session id.
   */
  async create(userId, deviceId, metadata = {}) {
    if (!deviceId) throw new Error('deviceId is required to create a mobile session');
    const session = await createSession(userId, {
      deviceId,
      deviceModel: metadata?.deviceModel,
      osVersion: metadata?.osVersion,
      appVersion: metadata?.appVersion,
      userAgent: metadata?.userAgent,
      ipAddress: metadata?.ipAddress,
      ttlMs: metadata?.ttlMs ?? SESSION_TTL_MS,
    });
    return session.id;
  }

  async get(sessionId) {
    const session = await getActiveSession(sessionId);
    return session ? toMobileSession(session) : null;
  }

  /**
   * Resolve an active session and enforce its device binding.
   * @returns {Promise<object|null>} null when the session is missing, expired or revoked.
   * @throws {SessionDeviceMismatchError} When `deviceId` doesn't match the bound device,
   *   or the session isn't a device-bound (mobile) session at all.
   */
  async validate(sessionId, deviceId) {
    if (!deviceId) throw new SessionDeviceMismatchError('X-Device-Id header is required');
    const session = await getActiveSessionForDevice(sessionId, deviceId);
    if (!session) return null;
    if (!session.deviceId) {
      throw new SessionDeviceMismatchError('Session is not a device-bound mobile session');
    }
    return toMobileSession(session);
  }

  /**
   * Revoke a single session. Pass `userId` to scope the revocation to the
   * caller's own sessions.
   */
  async revoke(sessionId, userId) {
    return revokeSession(sessionId, userId);
  }

  /** Global logout — revokes the user's web and mobile sessions together. */
  async revokeAll(userId) {
    return revokeAllSessions(userId);
  }

  async listForUser(userId) {
    const sessions = await listUserSessions(userId);
    return sessions
      .filter((s) => s.deviceId)
      .map((s) => toMobileSession({ ...s, userId }));
  }
}

export default new MobileSessions();
