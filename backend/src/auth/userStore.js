import crypto from 'crypto';
import prisma from '../db/client.js';

const VERIFICATION_TTL_MS = 15 * 60 * 1000;

export function generateVerificationToken() {
  // Cryptographically secure 6-digit OTP (000000-999999).
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

export async function createUser(username, passwordHash, email) {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) throw new Error('User already exists');

  const verificationToken = generateVerificationToken();
  const verificationTokenExpiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      email,
      publicKey: `temp-${Date.now()}`,
      emailVerified: false,
      status: 'PENDING_VERIFICATION',
      verificationToken,
      verificationTokenExpiresAt,
    },
  });

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    status: user.status,
    verificationToken: user.verificationToken,
    verificationTokenExpiresAt: user.verificationTokenExpiresAt,
  };
}

export async function findUser(username) {
  return await prisma.user.findUnique({ where: { username } });
}

export async function getUserById(id) {
  return await prisma.user.findUnique({ where: { id } });
}

export async function verifyEmail(token) {
  if (!token) return { ok: false, reason: 'MISSING_TOKEN' };

  const user = await prisma.user.findFirst({ where: { verificationToken: token } });
  if (!user) return { ok: false, reason: 'INVALID_TOKEN' };

  if (!user.verificationTokenExpiresAt || user.verificationTokenExpiresAt.getTime() < Date.now()) {
    return { ok: false, reason: 'EXPIRED_TOKEN' };
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      status: 'ACTIVE',
      verificationToken: null,
      verificationTokenExpiresAt: null,
    },
  });

  return { ok: true, user: { id: updated.id, username: updated.username, emailVerified: updated.emailVerified, status: updated.status } };
}

export async function updateUserPassword(id, passwordHash) {
  try {
    await prisma.user.update({ where: { id }, data: { passwordHash } });
    return true;
  } catch {
    return false;
  }
}
