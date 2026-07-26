/**
 * Client-side encrypted account backup.
 *
 * Encrypts the user's Stellar keypair + local settings with a
 * user-supplied password (PBKDF2 → AES-256-GCM) so the resulting file can be
 * stored offline. The server never sees the plaintext or the password.
 */

const FORMAT_VERSION = 1;
const PBKDF2_ITERATIONS = 250000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export const BACKUP_ERROR_CODES = {
  CORRUPTED_FILE: 'CORRUPTED_FILE',
  WRONG_PASSWORD: 'WRONG_PASSWORD',
};

function backupError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function deriveAesKey(password, saltBytes, usage) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

/**
 * Encrypt a backup payload (keypair + settings) with a user-supplied password.
 * @param {object} payload - e.g. { publicKey, secretKey, accountLabel }
 * @param {string} password
 * @returns {Promise<object>} envelope — safe to JSON.stringify and download
 */
export async function encryptBackup(payload, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(password, salt, 'encrypt');

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  return {
    version: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    salt: arrayBufferToBase64(salt),
    iv: arrayBufferToBase64(iv),
    ciphertext: arrayBufferToBase64(ciphertext),
  };
}

/** Serialise an envelope (from encryptBackup) to a JSON string for download. */
export function serializeBackupFile(envelope) {
  return JSON.stringify(envelope, null, 2);
}

/**
 * Parse and structurally validate a backup file's contents.
 * Throws a CORRUPTED_FILE error if the envelope is malformed.
 */
export function parseBackupFile(fileText) {
  let envelope;
  try {
    envelope = JSON.parse(fileText);
  } catch {
    throw backupError(BACKUP_ERROR_CODES.CORRUPTED_FILE, 'The backup file is not valid and could not be read.');
  }

  const hasRequiredFields =
    envelope &&
    typeof envelope === 'object' &&
    typeof envelope.version === 'number' &&
    typeof envelope.salt === 'string' &&
    typeof envelope.iv === 'string' &&
    typeof envelope.ciphertext === 'string';

  if (!hasRequiredFields) {
    throw backupError(BACKUP_ERROR_CODES.CORRUPTED_FILE, 'The backup file is missing required data and appears corrupted.');
  }

  return envelope;
}

/**
 * Decrypt a parsed backup envelope with the user-supplied password.
 * @returns {Promise<object>} the original payload — { publicKey, secretKey, accountLabel, ... }
 */
export async function decryptBackup(envelope, password) {
  const salt = new Uint8Array(base64ToArrayBuffer(envelope.salt));
  const iv = new Uint8Array(base64ToArrayBuffer(envelope.iv));
  const ciphertext = base64ToArrayBuffer(envelope.ciphertext);
  const key = await deriveAesKey(password, salt, 'decrypt');

  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch {
    throw backupError(BACKUP_ERROR_CODES.WRONG_PASSWORD, 'Incorrect backup password.');
  }

  return JSON.parse(new TextDecoder().decode(plaintext));
}

/** Build the download filename, e.g. future-backup-2026-07-26.enc */
export function buildBackupFilename(date = new Date()) {
  const iso = date.toISOString().slice(0, 10);
  return `future-backup-${iso}.enc`;
}

/** Trigger a browser download of the given text content. */
export function downloadBackupFile(filename, contents) {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const STRENGTH_LABELS = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];

/**
 * Simple heuristic password strength scorer (0-4) for the backup password field.
 * Not a substitute for a full zxcvbn-style estimator, but enough to nudge users
 * away from trivially weak backup passwords.
 */
export function scorePasswordStrength(password) {
  if (!password) return { score: 0, label: STRENGTH_LABELS[0] };

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const clamped = Math.min(score, STRENGTH_LABELS.length - 1);
  return { score: clamped, label: STRENGTH_LABELS[clamped] };
}
