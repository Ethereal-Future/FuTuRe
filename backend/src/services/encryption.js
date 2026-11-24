/**
 * backend/src/services/encryption.js
 *
 * AES-256-GCM encryption for sensitive Stellar key material.
 *
 * Fix for ISSUE-311: When the AES-GCM authentication tag did not match the
 * ciphertext, Node.js threw an unhandled TypeError that left decipher buffers
 * allocated in memory without being zeroed. This module now wraps the
 * `decipher.final()` call in a try/catch, scrubs every intermediate Buffer
 * with zeros on failure, and re-throws a domain-specific
 * `DecryptionAuthenticationError` so callers receive a typed, actionable error
 * rather than a raw engine exception.
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown when AES-GCM authentication tag verification fails. Callers should
 * treat this as a fatal, non-retryable condition and discard the ciphertext.
 */
export class DecryptionAuthenticationError extends Error {
  constructor(message = 'AES-GCM authentication tag mismatch') {
    super(message);
    this.name = 'DecryptionAuthenticationError';
    this.code = 'DECRYPTION_AUTH_FAILURE';
  }
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/**
 * Load and validate the AES-256 encryption key from the environment.
 *
 * @returns {Buffer} 32-byte key buffer.
 * @throws {Error} When the env var is absent or not a valid 32-byte hex string.
 */
function loadEncryptionKey() {
  const hex = process.env.STELLAR_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('STELLAR_ENCRYPTION_KEY environment variable is not set');
  }
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error(
      `STELLAR_ENCRYPTION_KEY must be a 64-character hex string (32 bytes); got ${buf.length} bytes`,
    );
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * @param {string} plaintext  - UTF-8 string to encrypt.
 * @returns {string} Base64url-encoded payload: `<iv>.<tag>.<ciphertext>`.
 */
export function encrypt(plaintext) {
  const key = loadEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertextBuf = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Encode as three base64url segments so the payload is URL-safe.
  return [iv, tag, ciphertextBuf]
    .map((b) => b.toString('base64url'))
    .join('.');
}

/**
 * Decrypt an AES-256-GCM payload produced by `encrypt`.
 *
 * @param {string} payload - Base64url-encoded `<iv>.<tag>.<ciphertext>` string.
 * @returns {string} Decrypted UTF-8 plaintext.
 * @throws {DecryptionAuthenticationError} When authentication tag verification fails.
 * @throws {Error} When the payload is malformed.
 */
export function decrypt(payload) {
  const parts = String(payload).split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format; expected <iv>.<tag>.<ciphertext>');
  }

  const key = loadEncryptionKey();
  const iv = Buffer.from(parts[0], 'base64url');
  const tag = Buffer.from(parts[1], 'base64url');
  const ciphertext = Buffer.from(parts[2], 'base64url');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  // Accumulate intermediate buffers so we can zero them on failure.
  let updateBuf = null;
  let finalBuf = null;

  try {
    updateBuf = decipher.update(ciphertext);
    // final() is where Node.js verifies the authentication tag.
    finalBuf = decipher.final();
    return Buffer.concat([updateBuf, finalBuf]).toString('utf8');
  } catch (err) {
    // Scrub any plaintext that may have been produced before the tag check.
    if (updateBuf) updateBuf.fill(0);
    if (finalBuf) finalBuf.fill(0);

    if (
      err.message?.includes('Unsupported state') ||
      err.message?.includes('auth') ||
      err.code === 'ERR_CRYPTO_INVALID_AUTH_TAG'
    ) {
      throw new DecryptionAuthenticationError();
    }
    throw err;
  }
}
