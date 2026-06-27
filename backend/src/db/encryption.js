import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey() {
  const raw = process.env.DATABASE_ENCRYPTION_KEY;
  if (!raw) throw new Error('DATABASE_ENCRYPTION_KEY environment variable is required');
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error('DATABASE_ENCRYPTION_KEY must be 32 bytes (64 hex characters)');
  return key;
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns a colon-separated string: iv:tag:ciphertext (all hex-encoded).
 */
export function encrypt(plaintext) {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypt a value produced by encrypt().
 */
export function decrypt(encryptedValue) {
  const key = getKey();
  const [ivHex, tagHex, ciphertextHex] = encryptedValue.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * Call at startup — fails fast with a clear error if the key is missing or invalid.
 */
export function validateEncryptionKey() {
  getKey();
}
