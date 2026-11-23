/**
 * backend/src/services/auth.js
 *
 * Token-rotation helper used during refresh-token validation.
 *
 * Fix for ISSUE-310: The previous implementation compared stored refresh-token
 * hashes with `===`, enabling side-channel timing attacks that could leak
 * valid token hashes character by character. All hash comparisons now go
 * through `crypto.timingSafeEqual` over equal-length Buffers, running in
 * constant time regardless of match position.
 */

import crypto from 'node:crypto';

/**
 * Compare two string values in constant time to prevent timing side-channels.
 *
 * Both values are encoded as UTF-8 Buffers.  When their lengths differ the
 * function still performs a full-length comparison against a zero-padded copy
 * of the shorter string before returning `false`, so the response time does
 * not reveal the length difference.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');

  // timingSafeEqual requires both buffers to have the same length.
  // Pad the shorter one so the comparison always runs to completion.
  if (bufA.length !== bufB.length) {
    const maxLen = Math.max(bufA.length, bufB.length);
    const paddedA = Buffer.alloc(maxLen);
    const paddedB = Buffer.alloc(maxLen);
    bufA.copy(paddedA);
    bufB.copy(paddedB);
    // Result is always false when lengths differ — we just avoid the
    // early-exit timing leak.
    crypto.timingSafeEqual(paddedA, paddedB);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a plain-text refresh token against its stored SHA-256 hex digest.
 *
 * Returns `true` only when the HMAC-free hash of `token` matches `storedHash`
 * in constant time.
 *
 * @param {string} token       - The raw refresh token from the client.
 * @param {string} storedHash  - The SHA-256 hex string stored in the database.
 * @returns {boolean}
 */
export function verifyRefreshTokenHash(token, storedHash) {
  const candidateHash = crypto
    .createHash('sha256')
    .update(String(token), 'utf8')
    .digest('hex');

  return timingSafeStringEqual(candidateHash, storedHash);
}

/**
 * Hash a refresh token for safe storage.
 *
 * @param {string} token
 * @returns {string} SHA-256 hex digest.
 */
export function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}
