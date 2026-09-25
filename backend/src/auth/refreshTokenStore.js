/**
 * Refresh token rotation with token families (OAuth 2.0 Security BCP).
 * Each refresh token is one-time use; replaying a used/revoked jti revokes the whole family.
 * In-memory store mirroring the Prisma `RefreshToken` model (userStore is also in-memory).
 */
import logger from '../config/logger.js';

const tokens = new Map(); // jti -> { jti, familyId, userId, isUsed, isRevoked, expiresAt }

export function saveRefreshToken({ jti, familyId, userId, expiresAt }) {
  tokens.set(jti, { jti, familyId, userId, isUsed: false, isRevoked: false, expiresAt });
}

export function revokeFamily(familyId) {
  for (const t of tokens.values()) if (t.familyId === familyId) t.isRevoked = true;
}

export function revokeUserTokens(userId) {
  for (const t of tokens.values()) if (t.userId === userId) t.isRevoked = true;
}

/**
 * Consumes a refresh token. Returns { ok: true } or { ok: false, reason }.
 * Reuse of a consumed token is treated as theft: the entire family is revoked.
 */
export function consumeRefreshToken(jti, familyId) {
  const record = tokens.get(jti);
  if (!record || record.familyId !== familyId) return { ok: false, reason: 'unknown' };
  if (record.isUsed || record.isRevoked) {
    revokeFamily(record.familyId);
    logger.warn('auth.refreshToken.replayDetected', { userId: record.userId, familyId: record.familyId });
    return { ok: false, reason: 'replay' };
  }
  if (record.expiresAt <= new Date()) return { ok: false, reason: 'expired' };
  record.isUsed = true;
  return { ok: true, record };
}

export function purgeExpiredRefreshTokens(now = new Date()) {
  let removed = 0;
  for (const [jti, t] of tokens) {
    if (t.expiresAt <= now) {
      tokens.delete(jti);
      removed += 1;
    }
  }
  return removed;
}

// Hourly cleanup job
const cleanup = setInterval(() => purgeExpiredRefreshTokens(), 60 * 60 * 1000);
cleanup.unref?.();
