import prisma from '../db/client.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function parseDevice(userAgent) {
  if (!userAgent) return 'Unknown device';
  if (/iPhone|iPad/i.test(userAgent)) return 'iPhone / iPad';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Macintosh|Mac OS/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Web browser';
}

export async function createSession(userId, { ipAddress, userAgent } = {}) {
  return prisma.session.create({
    data: {
      userId,
      device: parseDevice(userAgent),
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
}

export async function getActiveSession(sessionId) {
  if (!sessionId) return null;
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (session) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { lastActiveAt: new Date() },
    });
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
      ipAddress: true,
      lastActiveAt: true,
      createdAt: true,
    },
  });
  return sessions.map((s) => ({
    ...s,
    current: s.id === currentSessionId,
  }));
}

export async function revokeSession(sessionId, userId) {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export async function revokeAllSessions(userId, exceptSessionId = null) {
  const where = { userId, revokedAt: null };
  if (exceptSessionId) {
    where.id = { not: exceptSessionId };
  }
  const result = await prisma.session.updateMany({
    where,
    data: { revokedAt: new Date() },
  });
  return result.count;
}
