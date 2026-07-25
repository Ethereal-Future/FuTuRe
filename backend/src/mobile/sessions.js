import crypto from 'crypto';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

class MobileSessions {
  constructor() {
    // sessionId -> session object
    this.sessions = new Map();
  }

  create(userId, deviceId, metadata = {}) {
    const sessionId = crypto.randomUUID();
    this.sessions.set(sessionId, {
      sessionId,
      userId,
      deviceId,
      metadata,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return sessionId;
  }

  get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }
    session.lastActiveAt = Date.now();
    return session;
  }

  revoke(sessionId) {
    return this.sessions.delete(sessionId);
  }

  revokeAll(userId) {
    let count = 0;
    for (const [id, s] of this.sessions) {
      if (s.userId === userId) { this.sessions.delete(id); count++; }
    }
    return count;
  }

  listForUser(userId) {
    return [...this.sessions.values()].filter(s => s.userId === userId);
  }
}

export default new MobileSessions();
